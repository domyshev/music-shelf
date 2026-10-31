import { useState, useMemo, useDeferredValue, useEffect, type FormEvent } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, LinearProgress, Menu, MenuItem, Stack, ToggleButton, ToggleButtonGroup, TextField, Tooltip, Typography } from '@mui/material';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { signIn, signOut, uiActions, useAppDispatch, useAppSelector, useCatalogQuery } from './store';
import type { CatalogQuery } from '../shared/catalog';
import { version } from '../package.json';
import { LibraryTable } from './components/LibraryTable';
import { HistoryPopover } from './components/HistoryPopover';
import { TrackDetails } from './components/TrackDetails';

function Wordmark() { return <Typography component="span" className="wordmark">music shelf<span>•</span></Typography>; }
function Login() {
  const dispatch = useAppDispatch(); const { checking, error } = useAppSelector(state => state.auth); const [code, setCode] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); if (await dispatch(signIn(code))) setCode(''); }
  return <Box className="login-screen"><Box component="form" onSubmit={submit} className="login-panel"><Wordmark /><Typography component="h1" sx={{ fontSize: 18, fontWeight: 600, mt: 3 }}>Music library</Typography><Typography color="text.secondary" sx={{ fontSize: 12, mt: 1, mb: 3 }}>Enter your access code. This browser will remember it.</Typography><TextField fullWidth autoFocus label="Access code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required />{error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}<Button type="submit" variant="contained" fullWidth disabled={checking} sx={{ mt: 2, height: 34 }}>{checking ? 'Checking…' : 'Open library'}</Button></Box></Box>;
}
export default function App() {
  const dispatch = useAppDispatch(); const authenticated = useAppSelector(state => state.auth.authenticated);
  const { search, detailsId, theme, sorting, columnFilters, page, pageSize } = useAppSelector(state => state.ui);
  const deferredSearch = useDeferredValue(search);
  const catalogQuery = useMemo<CatalogQuery>(() => ({ page, pageSize, q: deferredSearch, sort: (sorting[0]?.id ?? 'position') as CatalogQuery['sort'], direction: sorting[0]?.desc ? 'desc' : 'asc', filters: Object.fromEntries(columnFilters.map(filter => [filter.id, filter.value])) }), [page, pageSize, deferredSearch, sorting, columnFilters]);
  const { currentData: data, isLoading, isFetching, isError, refetch } = useCatalogQuery(catalogQuery, { skip: !authenticated, pollingInterval: 30000, skipPollingIfUnfocused: true, refetchOnFocus: true, refetchOnReconnect: true });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null); const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => { if (data?.pagination && page > Math.max(1, data.pagination.pages)) dispatch(uiActions.setPage(Math.max(1, data.pagination.pages))); }, [data?.pagination, page, dispatch]);
  if (!authenticated) return <Login />;
  const stats = data?.stats;
  return <Box className="app-shell">
    <Box component="header" className="app-header"><Wordmark /><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography component="span" color="text.secondary" sx={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{version}</Typography><Tooltip title="Menu"><IconButton aria-label="Open menu" onClick={event => setMenuAnchor(event.currentTarget)}><MenuRounded fontSize="small" /></IconButton></Tooltip></Box><Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}><Box sx={{ px: 1.5, pt: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider', mb: 0.5 }}><ToggleButtonGroup exclusive value={theme} aria-label="Appearance" size="small" onChange={(_event, value) => { if (value) dispatch(uiActions.setTheme(value)); }}>
      <ToggleButton value="light" aria-label="Light theme"><Tooltip title="Light"><LightModeOutlined fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="system" aria-label="System theme"><Tooltip title="System"><SettingsBrightnessOutlined fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="dark" aria-label="Dark theme"><Tooltip title="Dark"><DarkModeOutlined fontSize="small" /></Tooltip></ToggleButton>
    </ToggleButtonGroup></Box><MenuItem onClick={() => { setMenuAnchor(null); setHistoryAnchor(null); dispatch(signOut()); }}><LogoutRounded sx={{ fontSize: 17, mr: 1 }} />Sign out</MenuItem></Menu></Box>
    <Box component="main" className="workspace">
      <Box className="toolbar"><TextField placeholder="Search songs, artists and albums" aria-label="Search songs" value={search} onChange={event => dispatch(uiActions.setSearch(event.target.value))} className="search" slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment>, endAdornment: search ? <InputAdornment position="end"><IconButton aria-label="Clear search" onClick={() => dispatch(uiActions.setSearch(''))}><CloseRounded sx={{ fontSize: 15 }} /></IconButton></InputAdornment> : undefined } }} />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} className="statistics" aria-live="polite">{data?.demo && <Typography className="demo-label" component="span" color="warning.main" sx={{ fontSize: 10 }}>Demo · fictional songs</Typography>}<Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>Total <b>{stats?.total ?? '—'}</b></Typography><Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>ready <b className="ready-number">{stats?.ready ?? '—'}</b></Typography><Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>pending <b>{stats?.pending ?? '—'}</b></Typography><Tooltip title="Download history"><IconButton aria-label="Download history" onClick={event => setHistoryAnchor(event.currentTarget)}><HistoryRounded sx={{ fontSize: 20 }} /></IconButton></Tooltip></Stack>
      </Box>
      <Box className="loading-line">{isFetching && <LinearProgress sx={{ height: 2 }} />}</Box>
      {isError && <Alert severity="warning" sx={{ mb: 1 }} action={<Button onClick={() => void refetch()}>Retry</Button>}>{data ? 'Unable to refresh the library. Showing the last available data.' : 'Unable to load the library.'}</Alert>}
      {isLoading || (isFetching && !data) ? <Box className="initial-loading"><CircularProgress size={24} /></Box> : <LibraryTable tracks={data?.tracks ?? []} total={data?.pagination?.total ?? 0} facets={data?.facets} />}
    </Box>
    <HistoryPopover anchor={historyAnchor} onClose={() => setHistoryAnchor(null)} />
    <TrackDetails track={data?.tracks.find(track => track.id === detailsId)} onClose={() => dispatch(uiActions.setDetails(null))} />
  </Box>;
}
