import { configureStore, createSlice, type PayloadAction, type ThunkAction, type UnknownAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import type { SortingState, ColumnSizingState, ColumnFiltersState } from '@tanstack/react-table';
import { eventKinds, type CatalogResponse, type CatalogQuery, type HistoryResponse, type HistoryFilters, type LibraryEvent } from '../shared/catalog';
import { emptyHistorySelection, isCalendarDate, type HistorySelection } from './historyFilters';

// Retire the previous shared-code credential; preferences remain untouched.
try { localStorage.removeItem('music-shelf.access-code'); } catch {}
const auth = createSlice({ name: 'auth', initialState: { authenticated: false, bootstrapping: true, checking: false, email: '', error: '' }, reducers: {
  checking(state) { state.checking = true; state.error = ''; },
  authenticated(state, action: PayloadAction<string>) { state.authenticated = true; state.bootstrapping = false; state.checking = false; state.email = action.payload; state.error = ''; },
  failed(state, action: PayloadAction<string>) { state.checking = false; state.bootstrapping = false; state.error = action.payload; },
  loggedOut(state) { state.authenticated = false; state.bootstrapping = false; state.checking = false; state.email = ''; state.error = ''; },
} });
export type ThemeChoice = 'light' | 'system' | 'dark';
export const columnIds = ['status', 'title', 'artist', 'year', 'sampleRate', 'bitDepth', 'sizeBytes'];
function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('music-shelf.preferences') ?? '{}');
    const columnOrder = Array.isArray(saved.columnOrder) && saved.columnOrder.length === columnIds.length && new Set(saved.columnOrder).size === columnIds.length && saved.columnOrder.every((id: string) => columnIds.includes(id)) ? saved.columnOrder as string[] : columnIds;
    const columnSizing: ColumnSizingState = {};
    for (const id of columnIds) if (Number.isFinite(saved.columnSizing?.[id])) columnSizing[id] = Math.max(64, Math.min(1200, saved.columnSizing[id]));
    const theme: ThemeChoice = ['light', 'system', 'dark'].includes(saved.theme) ? saved.theme : 'system';
    const columnFilters: ColumnFiltersState = Array.isArray(saved.columnFilters) ? saved.columnFilters.filter((filter: { id?: unknown; value?: unknown }) => filter && ['status', 'artist', 'year'].includes(String(filter.id)) && Array.isArray(filter.value) && filter.value.length <= 10000 && filter.value.every((value: unknown) => typeof value === 'string' && value.length <= 1000)) : [];
    const raw = saved.historyFilters;
    const historyFilters: HistorySelection = {
      kinds: Array.isArray(raw?.kinds) ? [...new Set(raw.kinds.filter((kind: unknown) => eventKinds.includes(kind as typeof eventKinds[number])))] as HistorySelection['kinds'] : [],
      start: isCalendarDate(raw?.start) ? raw.start : '',
      end: isCalendarDate(raw?.end) ? raw.end : '',
    };
    if (historyFilters.start && historyFilters.end && historyFilters.start > historyFilters.end) { historyFilters.start = ''; historyFilters.end = ''; }
    return { columnOrder, columnSizing, theme, columnFilters, historyFilters };
  } catch { return { columnOrder: columnIds, columnSizing: {} as ColumnSizingState, theme: 'system' as ThemeChoice, columnFilters: [] as ColumnFiltersState, historyFilters: emptyHistorySelection }; }
}
const preferences = readPreferences();
const { historyFilters: savedHistoryFilters, ...uiPreferences } = preferences;
const ui = createSlice({ name: 'ui', initialState: { page: 1, pageSize: 25, search: '', sorting: [] as SortingState, detailsId: null as string | null, ...uiPreferences }, reducers: {
  setPage(state, action: PayloadAction<number>) { state.page = action.payload; },
  setPageSize(state, action: PayloadAction<number>) { state.pageSize = action.payload; state.page = 1; },
  setSearch(state, action: PayloadAction<string>) { state.search = action.payload; state.page = 1; },
  setSorting(state, action: PayloadAction<SortingState>) { state.sorting = action.payload; state.page = 1; },
  setDetails(state, action: PayloadAction<string | null>) { state.detailsId = action.payload; },
  setColumnSizing(state, action: PayloadAction<ColumnSizingState>) { state.columnSizing = action.payload; },
  setColumnOrder(state, action: PayloadAction<string[]>) { state.columnOrder = action.payload; },
  setColumnFilters(state, action: PayloadAction<ColumnFiltersState>) { state.columnFilters = action.payload; state.page = 1; },
  setTheme(state, action: PayloadAction<ThemeChoice>) { state.theme = action.payload; },
} });
const history = createSlice({ name: 'history', initialState: { generation: '', events: [] as LibraryEvent[], nextCursor: null as string | null, loaded: false, total: 0, filters: savedHistoryFilters }, reducers: {
  setFilters(state, action: PayloadAction<HistorySelection>) { state.filters = action.payload; state.generation = ''; state.events = []; state.nextCursor = null; state.loaded = false; state.total = 0; },
  opened(state, action: PayloadAction<string>) { state.generation = action.payload; state.events = []; state.nextCursor = null; state.loaded = false; state.total = 0; },
  pageReceived(state, action: PayloadAction<{ generation: string; page: HistoryResponse }>) {
    if (action.payload.generation !== state.generation) return;
    const byId = new Map(state.events.map(event => [event.id, event]));
    for (const event of action.payload.page.events) byId.set(event.id, event);
    state.events = [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
    state.total = action.payload.page.total; state.nextCursor = action.payload.page.nextCursor; state.loaded = true;
  },
} });
const rawQuery = fetchBaseQuery({ baseUrl: '/api', credentials: 'same-origin' });
const guardedQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await rawQuery(args, api, extra);
  if (result.error?.status === 401) api.dispatch(auth.actions.loggedOut());
  return result;
};
export const libraryApi = createApi({ reducerPath: 'libraryApi', baseQuery: guardedQuery, endpoints: builder => ({
  catalog: builder.query<CatalogResponse, CatalogQuery>({ query: args => ({ url: '/catalog', params: { ...args, filters: JSON.stringify(args.filters) } }) }),
  history: builder.query<HistoryResponse, { cursor?: string; generation: string; filters: HistoryFilters }>({
    query: ({ cursor, filters }) => ({ url: '/history', params: { limit: 100, ...(cursor ? { cursor } : {}), ...(filters.kinds?.length ? { kind: filters.kinds.join(',') } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) } }),
    async onQueryStarted(args, { dispatch, queryFulfilled }) { try { const { data } = await queryFulfilled; dispatch(history.actions.pageReceived({ generation: args.generation, page: data })); } catch {} },
  }),
}) });
export const store = configureStore({ reducer: { auth: auth.reducer, ui: ui.reducer, history: history.reducer, [libraryApi.reducerPath]: libraryApi.reducer }, middleware: getDefault => getDefault().concat(libraryApi.middleware) });
let lastPreferences = '';
store.subscribe(() => {
  const { columnOrder, columnSizing, columnFilters, theme } = store.getState().ui;
  const historyFilters = store.getState().history.filters;
  const value = JSON.stringify({ columnOrder, columnSizing, columnFilters, theme, historyFilters });
  if (value !== lastPreferences) { lastPreferences = value; try { localStorage.setItem('music-shelf.preferences', value); } catch {} }
});
setupListeners(store.dispatch);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
type AppThunk<Return = void> = ThunkAction<Return, RootState, unknown, UnknownAction>;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const uiActions = ui.actions;
export const historyActions = history.actions;
export const { useCatalogQuery, useLazyHistoryQuery } = libraryApi;
async function authRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/auth/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Unable to sign in. Please try again.');
  return result;
}
export async function requestLoginCode(email: string): Promise<{ challengeId: string; expiresIn: number; resendAfter: number }> {
  return authRequest('request-code', { email });
}
export function restoreSession(): AppThunk<Promise<void>> {
  return async dispatch => {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { dispatch(auth.actions.loggedOut()); return; }
      const session = await response.json(); dispatch(auth.actions.authenticated(session.email));
    } catch { dispatch(auth.actions.loggedOut()); }
  };
}
export function signOut(): AppThunk<Promise<void>> {
  return async dispatch => {
    dispatch(auth.actions.checking());
    try {
      await authRequest('logout'); dispatch(auth.actions.loggedOut()); dispatch(libraryApi.util.resetApiState()); dispatch(ui.actions.setDetails(null));
    } catch { dispatch(auth.actions.failed('Unable to sign out. Please try again.')); }
  };
}
export function signIn(challengeId: string, code: string): AppThunk<Promise<boolean>> {
  return async dispatch => {
    dispatch(auth.actions.checking());
    try {
      const session = await authRequest('verify-code', { challengeId, code });
      dispatch(libraryApi.util.resetApiState()); dispatch(auth.actions.authenticated(session.email)); return true;
    } catch (error) { dispatch(auth.actions.failed(error instanceof Error ? error.message : 'Unable to sign in.')); return false; }
  };
}
void store.dispatch(restoreSession());
