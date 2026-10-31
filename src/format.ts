export const formatSize = (bytes?: number | null) => bytes == null ? '—' : `${(bytes / 1048576).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MiB`;
export const formatRate = (rate?: number | null) => rate ? (rate / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 }) : '—';
export const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(date));
export function normalize(value: string) { return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase(); }
