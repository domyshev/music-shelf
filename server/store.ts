import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { CatalogQuery, CatalogResponse, HistoryResponse, HistoryFilters, LibraryEvent, Snapshot, Track } from '../shared/catalog.js';

const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export class SnapshotConflict extends Error {}
export class CatalogStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE,
        track_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
        kind TEXT NOT NULL, occurred_at TEXT NOT NULL, time_basis TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_order ON events(occurred_at DESC, id DESC);`);
    const columns = this.db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'search_text')) {
      this.db.exec("ALTER TABLE tracks ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
      for (const row of this.db.prepare('SELECT id, payload FROM tracks').all() as { id: string; payload: string }[]) {
        this.db.prepare('UPDATE tracks SET search_text=? WHERE id=?').run(this.searchText(JSON.parse(row.payload)), row.id);
      }
    }
  }
  private searchText(track: Track) { return normalizeSearch([track.title, track.artist, track.album, track.year ?? '', track.status].join(' ')); }
  close() { this.db.close(); }
  catalog(): CatalogResponse {
    const generatedAt = this.meta('generatedAt') ?? new Date(0).toISOString();
    const tracks = (this.db.prepare('SELECT payload FROM tracks ORDER BY position').all() as { payload: string }[]).map(row => JSON.parse(row.payload) as Track);
    const ready = tracks.filter(track => track.status === 'ready');
    return { generatedAt, tracks, stats: { total: tracks.length, ready: ready.length, pending: tracks.length - ready.length, sizeBytes: ready.reduce((sum, track) => sum + (track.file?.sizeBytes ?? 0), 0) } };
  }
  catalogPage(query: CatalogQuery): CatalogResponse {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (query.q) { clauses.push('instr(search_text, ?) > 0'); values.push(normalizeSearch(query.q)); }
    for (const key of ['status', 'artist', 'year'] as const) {
      const selected = query.filters[key];
      if (selected?.length) { clauses.push(`COALESCE(CAST(json_extract(payload, '$.${key}') AS TEXT), '') IN (${selected.map(() => '?').join(',')})`); values.push(...selected); }
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM tracks${where}`).get(...values) as { total: number }).total);
    const sortFields: Record<CatalogQuery['sort'], string> = {
      position: 'position', status: "json_extract(payload, '$.status')", title: "json_extract(payload, '$.title') COLLATE NOCASE", artist: "json_extract(payload, '$.artist') COLLATE NOCASE",
      year: "json_extract(payload, '$.year')", sampleRate: "json_extract(payload, '$.file.sampleRate')", bitDepth: "json_extract(payload, '$.file.bitDepth')", sizeBytes: "json_extract(payload, '$.file.sizeBytes')", attempts: "json_extract(payload, '$.attempts')", queuedAt: "json_extract(payload, '$.queuedAt')", completedAt: "json_extract(payload, '$.completedAt')",
    };
    const expression = sortFields[query.sort];
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
    const rows = this.db.prepare(`SELECT payload FROM tracks${where} ORDER BY ${expression} ${direction} NULLS LAST, id ASC LIMIT ? OFFSET ?`).all(...values, query.pageSize, (query.page - 1) * query.pageSize) as { payload: string }[];
    const stats = this.db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(json_extract(payload, '$.status') = 'ready'),0) AS ready, COALESCE(SUM(json_extract(payload, '$.file.sizeBytes')),0) AS sizeBytes FROM tracks").get() as { total: number; ready: number; sizeBytes: number };
    const facets = { status: [] as string[], artist: [] as string[], year: [] as string[] };
    for (const key of ['status', 'artist', 'year'] as const) {
      facets[key] = (this.db.prepare(`SELECT DISTINCT COALESCE(CAST(json_extract(payload, '$.${key}') AS TEXT), '') AS value FROM tracks`).all() as { value: string }[]).map(row => row.value).sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    }
    return { generatedAt: this.meta('generatedAt') ?? new Date(0).toISOString(), tracks: rows.map(row => JSON.parse(row.payload)), stats: { ...stats, pending: stats.total - stats.ready }, pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) }, facets };
  }
  private meta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }
  import(snapshot: Snapshot) {
    const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const previousTime = this.meta('generatedAt');
    if (previousTime && snapshot.generatedAt <= previousTime) {
      if (snapshot.generatedAt === previousTime && digest === this.meta('digest')) return { duplicate: true, eventsAdded: 0 };
      throw new SnapshotConflict('A newer snapshot already exists');
    }
    const previous = new Map(this.catalog().tracks.map(track => [track.id, track]));
    let eventsAdded = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM tracks');
      const insert = this.db.prepare('INSERT INTO tracks(id, position, payload, search_text) VALUES (?, ?, ?, ?)');
      for (const [position, track] of snapshot.tracks.entries()) {
        insert.run(track.id, position, JSON.stringify(track), this.searchText(track));
        const old = previous.get(track.id);
        if (track.queuedAt || (!old && track.status === 'pending')) {
          const queuedKey = `queued:${track.id}`;
          const queued = this.db.prepare('SELECT id, time_basis FROM events WHERE event_key = ?').get(queuedKey) as { id: number; time_basis: string } | undefined;
          if (!queued) {
            this.addEvent(queuedKey, track, 'queued', track.queuedAt ?? snapshot.generatedAt, track.queuedAt ? 'source' : 'observed');
            eventsAdded++;
          } else if (queued.time_basis === 'observed' && track.queuedAt) {
            this.db.prepare("UPDATE events SET occurred_at=?, time_basis='source' WHERE id=?").run(track.queuedAt, queued.id);
          }
        }
        if (track.status === 'ready' && track.file) {
          const eventKey = `file:${track.id}:${track.file.sha256}`;
          const existing = this.db.prepare('SELECT id, time_basis FROM events WHERE event_key = ?').get(eventKey) as { id: number; time_basis: string } | undefined;
          if (existing) {
            if (old?.status === 'pending') {
              this.addEvent(`restored:${track.id}:${snapshot.generatedAt}`, track, 'restored', snapshot.generatedAt, 'observed'); eventsAdded++;
            }
            if (existing.time_basis === 'import' && track.completedAt) {
              this.db.prepare("UPDATE events SET kind='downloaded', occurred_at=?, time_basis='source' WHERE id=?").run(track.completedAt, existing.id);
            }
          } else {
            const kind = old?.status === 'ready' ? 'file_updated' : track.completedAt || old ? 'downloaded' : 'imported';
            const basis = kind === 'file_updated' ? 'observed' : track.completedAt ? 'source' : old ? 'observed' : 'import';
            this.addEvent(eventKey, track, kind, kind === 'file_updated' ? snapshot.generatedAt : track.completedAt ?? snapshot.generatedAt, basis);
            eventsAdded++;
          }
        } else if (old?.status === 'ready') {
          this.addEvent(`unavailable:${track.id}:${snapshot.generatedAt}`, track, 'unavailable', snapshot.generatedAt, 'observed');
          eventsAdded++;
        }
      }
      const put = this.db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)');
      put.run('generatedAt', snapshot.generatedAt); put.run('digest', digest);
      this.db.exec('COMMIT');
      return { duplicate: false, eventsAdded };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private addEvent(key: string, track: Track, kind: LibraryEvent['kind'], occurredAt: string, basis: LibraryEvent['timeBasis']) {
    this.db.prepare('INSERT INTO events(event_key,track_id,title,artist,kind,occurred_at,time_basis) VALUES (?,?,?,?,?,?,?)').run(key, track.id, track.title, track.artist, kind, occurredAt, basis);
  }
  history(limit = 100, cursor?: string, filters: HistoryFilters = {}): HistoryResponse {
    let anchor: { at: string; id: number } | undefined;
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (typeof value.at !== 'string' || !Number.isSafeInteger(value.id)) throw new Error();
        anchor = value;
      } catch { throw new Error('Invalid history cursor'); }
    }
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (filters.kinds?.length) {
      clauses.push(`kind IN (${filters.kinds.map(() => '?').join(',')})`);
      values.push(...filters.kinds);
    }
    if (filters.from) { clauses.push('occurred_at >= ?'); values.push(filters.from); }
    if (filters.to) { clauses.push('occurred_at < ?'); values.push(filters.to); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM events${where}`).get(...values) as { total: number }).total);
    if (anchor) { clauses.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))'); values.push(anchor.at, anchor.at, anchor.id); }
    const pageWhere = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM events${pageWhere} ORDER BY occurred_at DESC, id DESC LIMIT ?`).all(...values, limit + 1);
    const page = rows.slice(0, limit) as Record<string, string | number>[];
    const last = page.at(-1);
    return {
      total,
      events: page.map(row => ({ id: Number(row.id), trackId: String(row.track_id), title: String(row.title), artist: String(row.artist), kind: row.kind as LibraryEvent['kind'], occurredAt: String(row.occurred_at), timeBasis: row.time_basis as LibraryEvent['timeBasis'] })),
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.occurred_at, id: last.id })).toString('base64url') : null,
    };
  }
}
