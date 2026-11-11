import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const associationSchema = z.string().min(8).max(24).regex(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/);
const trackIdSchema = z.string().min(1).max(200);

/** Persistent selection metadata. Membership is independent of the current catalog snapshot. */
export class Tags {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS selection_tags (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, association TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL, basis TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS selection_tag_tracks (
      tag_id TEXT NOT NULL REFERENCES selection_tags(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(tag_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS selection_tags_owner ON selection_tags(owner, created_at);`);
    this.db.exec('PRAGMA foreign_keys=ON');
  }

  close() { this.db.close(); }

  create(owner: string, association: string, description: string, basis: object, trackIds: string[]) {
    association = associationSchema.parse(association);
    z.string().trim().min(1).max(10000).parse(description);
    const ids = z.array(trackIdSchema).min(1).max(1000).parse(trackIds);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate track IDs');
    const snapshot = JSON.stringify(basis);
    if (snapshot.length > 2000000) throw new Error('Selection context is too large');
    const id = randomUUID(), now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO selection_tags VALUES(?,?,?,?,?,?,?,?)').run(id, owner, `agent-${association}-${ids.length}`, association, description, snapshot, now, now);
      const insert = this.db.prepare('INSERT INTO selection_tag_tracks VALUES(?,?,?)');
      for (const trackId of ids) insert.run(id, trackId, now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(owner, id)!;
  }

  get(owner: string, id: string) {
    const row = this.db.prepare('SELECT id,name,association,description,basis,created_at AS createdAt,updated_at AS updatedAt FROM selection_tags WHERE owner=? AND id=?').get(owner, id) as {id:string;name:string;association:string;description:string;basis:string;createdAt:string;updatedAt:string}|undefined;
    if (!row) return null;
    const tracks = this.db.prepare('SELECT track_id AS trackId FROM selection_tag_tracks WHERE tag_id=? ORDER BY rowid').all(id) as {trackId:string}[];
    return {...row, basis: JSON.parse(row.basis) as unknown, trackIds: tracks.map(track => track.trackId)};
  }

  list(owner: string) {
    const rows = this.db.prepare('SELECT id FROM selection_tags WHERE owner=? ORDER BY created_at DESC, rowid DESC').all(owner) as {id:string}[];
    return rows.map(row => this.get(owner, row.id)!);
  }

  forTracks(owner: string, trackIds: string[]) {
    const result: Record<string, {id:string;name:string}[]> = Object.create(null);
    if (!trackIds.length) return result;
    const placeholders = trackIds.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT m.track_id AS trackId, t.id, t.name FROM selection_tag_tracks m JOIN selection_tags t ON t.id=m.tag_id WHERE t.owner=? AND m.track_id IN (${placeholders}) ORDER BY t.created_at, t.id`).all(owner, ...trackIds) as {trackId:string;id:string;name:string}[];
    for (const {trackId,id,name} of rows) (result[trackId] ??= []).push({id,name});
    return result;
  }
}
