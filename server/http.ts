import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotSchema, historyFilterSchema, catalogQuerySchema } from '../shared/catalog.js';
import { CatalogStore, SnapshotConflict } from './store.js';

export interface AppOptions { demo?: boolean; store: CatalogStore; accessHash: Buffer; publisherKey?: KeyObject; clientDirectory?: string; now?: () => number }
export function createApp(options: AppOptions) {
  const app = express();
  const now = options.now ?? Date.now;
  const failures = new Map<string, { count: number; until: number }>();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); next();
  });
  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  const authorize = (request: Request, response: Response, next: NextFunction) => {
    response.set('Cache-Control', 'no-store');
    const code = request.get('X-Access-Code') ?? '';
    if (code.length <= 256 && code && timingSafeEqual(createHash('sha256').update(code).digest(), options.accessHash)) { next(); return; }
    const key = request.ip ?? 'unknown'; const failure = failures.get(key);
    if (failure && failure.until > now() && failure.count >= 20) { response.status(429).json({ error: 'Too many attempts. Try again in a minute.' }); return; }
    if (failures.size > 10000) failures.clear();
    failures.set(key, failure && failure.until > now() ? { ...failure, count: failure.count + 1 } : { count: 1, until: now() + 60000 });
    response.status(401).json({ error: 'Access code required' });
  };
  app.get('/api/session', authorize, (_request, response) => response.json({ ok: true }));
  app.get('/api/catalog', authorize, (request, response) => {
    try {
      const raw = { ...request.query, ...(typeof request.query.filters === 'string' ? { filters: JSON.parse(request.query.filters) } : {}) };
      const parsed = catalogQuerySchema.safeParse(raw);
      if (!parsed.success) { response.status(400).json({ error: 'Invalid catalog query' }); return; }
      response.json({ ...options.store.catalogPage(parsed.data), demo: Boolean(options.demo) });
    } catch { response.status(400).json({ error: 'Invalid catalog query' }); }
  });
  app.get('/api/history', authorize, (request, response) => {
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    const cursor = request.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (cursor !== undefined && typeof cursor !== 'string') || (typeof cursor === 'string' && cursor.length > 1000)) { response.status(400).json({ error: 'Invalid pagination' }); return; }
    const { kind, from, to } = request.query;
    if ([kind, from, to].some(value => value !== undefined && typeof value !== 'string')) { response.status(400).json({ error: 'Invalid history filters' }); return; }
    const filters = historyFilterSchema.safeParse({ kinds: typeof kind === 'string' ? kind.split(',') : undefined, from, to });
    if (!filters.success) { response.status(400).json({ error: 'Invalid history filters' }); return; }
    try { response.json(options.store.history(limit, cursor, filters.data)); }
    catch { response.status(400).json({ error: 'Invalid history cursor' }); }
  });
  app.post('/api/import', express.raw({ type: 'application/json', limit: '8mb' }), (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!options.publisherKey) { response.status(503).json({ error: 'Snapshot publishing is not configured' }); return; }
    const timestamp = request.get('X-Shelf-Timestamp') ?? '';
    const signature = request.get('X-Shelf-Signature') ?? '';
    if (!/^\d{10,12}$/.test(timestamp) || Math.abs(now() - Number(timestamp) * 1000) > 300000 || !Buffer.isBuffer(request.body)) { response.status(400).json({ error: 'Invalid request timestamp or body' }); return; }
    try {
      const bytes = Buffer.from(signature, 'base64');
      if (bytes.length !== 64 || !verify(null, Buffer.concat([Buffer.from(timestamp + '\n'), request.body]), options.publisherKey, bytes)) { response.status(403).json({ error: 'Invalid publisher signature' }); return; }
      const parsed = snapshotSchema.safeParse(JSON.parse(request.body.toString('utf8')));
      if (!parsed.success || new Date(parsed.data.generatedAt).getTime() > now() + 300000) { response.status(400).json({ error: 'Invalid catalog snapshot' }); return; }
      const result = options.store.import(parsed.data);
      response.json({ ok: true, tracks: parsed.data.tracks.length, ...result });
    } catch (error) {
      response.status(error instanceof SnapshotConflict ? 409 : 400).json({ error: error instanceof SnapshotConflict ? error.message : 'Invalid catalog snapshot' });
    }
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));
  const directory = resolve(options.clientDirectory ?? 'dist/client');
  if (existsSync(directory)) {
    app.use(express.static(directory, { index: 'index.html', setHeaders: (response, file) => { response.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'); } }));
  }
  app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
  app.use((error: { status?: number }, _request: Request, response: Response, _next: NextFunction) => { response.status(error.status === 413 ? 413 : 500).json({ error: error.status === 413 ? 'Snapshot too large' : 'Request failed' }); });
  return app;
}
