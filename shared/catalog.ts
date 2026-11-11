import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const filename = z.string().min(1).max(512).refine(value => !/[\/\\\u0000-\u001f]/u.test(value), 'A basename is required');
export const audioFileSchema = z.object({
  name: filename,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.string().min(1).max(30),
  codec: z.string().min(1).max(50),
  sampleRate: z.number().int().positive(),
  bitDepth: z.number().int().min(0).max(64),
  channels: z.number().int().positive().max(64),
  durationSeconds: z.number().nonnegative(),
  bitrateBps: z.number().int().nonnegative(),
}).strict();
export const trackSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(1000),
  artist: z.string().min(1).max(1000),
  album: z.string().max(1000).default(''),
  year: z.number().int().min(1800).max(2200).nullable(),
  status: z.enum(['ready', 'pending']),
  file: audioFileSchema.nullable(),
  queuedAt: timestamp.nullable().optional(),
  completedAt: timestamp.nullable().optional(),
  attempts: z.number().int().nonnegative().nullable().optional(),
}).strict().superRefine((track, context) => {
  if ((track.status === 'ready') !== (track.file !== null)) {
    context.addIssue({ code: 'custom', path: ['file'], message: 'Only ready tracks have file properties' });
  }
});
export const snapshotSchema = z.object({
  generatedAt: timestamp,
  tracks: z.array(trackSchema).max(10000),
}).strict().superRefine((snapshot, context) => {
  if (new Set(snapshot.tracks.map(track => track.id)).size !== snapshot.tracks.length) {
    context.addIssue({ code: 'custom', path: ['tracks'], message: 'Duplicate track identifiers' });
  }
  if (snapshot.tracks.some(track => (track.completedAt && track.completedAt > snapshot.generatedAt) || (track.queuedAt && track.queuedAt > snapshot.generatedAt))) {
    context.addIssue({ code: 'custom', path: ['tracks'], message: 'Completion cannot follow snapshot time' });
  }
});
export type AudioFile = z.infer<typeof audioFileSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export const eventKinds = ['queued', 'downloaded', 'imported', 'file_updated', 'unavailable', 'restored'] as const;
export type EventKind = typeof eventKinds[number];
export const historyFilterSchema = z.object({
  kinds: z.array(z.enum(eventKinds)).max(eventKinds.length).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
}).strict().refine(value => !value.from || !value.to || value.from < value.to, 'Invalid date interval');
export type HistoryFilters = z.infer<typeof historyFilterSchema>;
export interface LibraryEvent {
  id: number;
  trackId: string;
  title: string;
  artist: string;
  kind: EventKind;
  occurredAt: string;
  timeBasis: 'source' | 'observed' | 'import';
}
export interface CatalogResponse extends Snapshot {
  demo?: boolean;
  tagsByTrack?: Record<string, {id:string;name:string}[]>;
  pagination?: { page: number; pageSize: number; total: number; pages: number };
  facets?: { status: string[]; artist: string[]; year: string[] };
  stats: { total: number; ready: number; pending: number; sizeBytes: number };
}
export interface HistoryResponse { total: number; events: LibraryEvent[]; nextCursor: string | null }

export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(100),
  q: z.string().max(1000).default(''),
  sort: z.enum(['position', 'status', 'title', 'artist', 'year', 'sampleRate', 'bitDepth', 'sizeBytes', 'attempts', 'queuedAt', 'completedAt']).default('position'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  filters: z.object({
    status: z.array(z.enum(['ready', 'pending'])).max(2).optional(),
    artist: z.array(z.string().max(1000)).max(10000).optional(),
    year: z.array(z.string().regex(/^(?:|(?:18|19|20|21)\d{2}|2200)$/)).max(500).optional(),
  }).strict().default({}),
}).strict();
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
