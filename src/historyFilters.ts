import type { EventKind, HistoryFilters } from '../shared/catalog';
export interface HistorySelection { kinds: EventKind[]; start: string; end: string }
export const emptyHistorySelection: HistorySelection = { kinds: [], start: '', end: '' };
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Both selected days are inclusive in the browser's local timezone, including DST. */
export function historyRequestFilters(selection: HistorySelection): HistoryFilters {
  const filters: HistoryFilters = {};
  if (selection.kinds.length) filters.kinds = selection.kinds;
  if (selection.start) filters.from = new Date(`${selection.start}T00:00:00`).toISOString();
  if (selection.end) {
    const end = new Date(`${selection.end}T00:00:00`);
    end.setDate(end.getDate() + 1);
    filters.to = end.toISOString();
  }
  return filters;
}
export const eventLabels: Record<EventKind, string> = { queued: 'Queued for download', downloaded: 'Downloaded', imported: 'Added to library', file_updated: 'File updated', unavailable: 'File unavailable', restored: 'File restored' };
