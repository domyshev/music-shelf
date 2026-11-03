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
import { signIn, signOut, requestLoginCode, uiActions, useAppDispatch, useAppSelector, useCatalogQuery } from './store';
import type { CatalogQuery } from '../shared/catalog';
import { version } from '../package.json';
import { LibraryTable } from './components/LibraryTable';
import { HistoryPopover } from './components/HistoryPopover';
import { TrackDetails } from './components/TrackDetails';
import { AiDrawer } from './components/AiDrawer';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';

function Wordmark() { return <Typography component="span" className="wordmark">music shelf<img src="/music-shelf.svg" alt="" aria-hidden="true" className="wordmark-icon" /></Typography>; }
function Login() {
  const dispatch = useAppDispatch();
  const { checking, error } = useAppSelector(state => state.auth);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState(''); const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(''); const [retryAt, setRetryAt] = useState(0); const [remaining, setRemaining] = useState(0);
  useEffect(() => { const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [retryAt]);
  async function send() {
    setSending(true); setSendError('');
    try { const result = await requestLoginCode(email); setChallengeId(result.challengeId); setCode(''); setRetryAt(Date.now() + result.resendAfter * 1000); }
    catch (error) { setSendError(error instanceof Error ? error.message : 'Unable to send a code. Please try again.'); }
    finally { setSending(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); if (!challengeId) await send(); else if (await dispatch(signIn(challengeId, code))) setCode(''); }
  return <Box className="login-screen"><Box component="form" onSubmit={submit} className="login-panel">
    <Wordmark /><Typography component="h1" sx={{ fontSize: 18, fontWeight: 600, mt: 3 }}>Sign in to Music Shelf</Typography>
    <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1, mb: 3 }}>{challengeId ? `Enter the six-digit code sent to ${email}. It expires in 10 minutes.` : 'We will email you a one-time sign-in code.'}</Typography>
    {!challengeId ? <TextField fullWidth autoFocus label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /> : <TextField key={challengeId} fullWidth autoFocus label="Verification code" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6 } }} required />}
    {(sendError || error) && <Alert severity="error" sx={{ mt: 2 }}>{sendError || error}</Alert>}
    <Button type="submit" variant="contained" fullWidth disabled={checking || sending || Boolean(challengeId && code.length !== 6)} sx={{ mt: 2, height: 34 }}>{checking ? 'Checking…' : sending ? 'Sending…' : challengeId ? 'Sign in' : 'Send code'}</Button>
    {challengeId && <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}><Button disabled={checking || sending} onClick={() => { setChallengeId(''); setCode(''); setSendError(''); }}>Change email</Button><Button disabled={checking || sending || remaining > 0} onClick={() => void send()}>{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</Button></Box>}
  </Box></Box>;
}
export default function App() {
  const dispatch = useAppDispatch(); const { authenticated, bootstrapping, error: authError } = useAppSelector(state => state.auth);
  const { search, detailsId, theme, sorting, columnFilters, page, pageSize } = useAppSelector(state => state.ui);
  const deferredSearch = useDeferredValue(search);
  const catalogQuery = useMemo<CatalogQuery>(() => ({ page, pageSize, q: deferredSearch, sort: (sorting[0]?.id ?? 'position') as CatalogQuery['sort'], direction: sorting[0]?.desc ? 'desc' : 'asc', filters: Object.fromEntries(columnFilters.map(filter => [filter.id, filter.value])) }), [page, pageSize, deferredSearch, sorting, columnFilters]);
  const { currentData: data, isLoading, isFetching, isError, refetch } = useCatalogQuery(catalogQuery, { skip: !authenticated, pollingInterval: 30000, skipPollingIfUnfocused: true, refetchOnFocus: true, refetchOnReconnect: true });
  const [aiOpen, setAiOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null); const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => { if (data?.pagination && page > Math.max(1, data.pagination.pages)) dispatch(uiActions.setPage(Math.max(1, data.pagination.pages))); }, [data?.pagination, page, dispatch]);
  if (bootstrapping) return <Box className="login-screen"><CircularProgress size={24} aria-label="Checking session" /></Box>;
  if (!authenticated) return <Login />;
  const stats = data?.stats;
  return <Box className="app-shell">
    <Box component="header" className="app-header"><Wordmark /><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography component="span" color="text.secondary" sx={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{version}</Typography><Tooltip title="Menu"><IconButton aria-label="Open menu" onClick={event => setMenuAnchor(event.currentTarget)}><MenuRounded fontSize="small" /></IconButton></Tooltip></Box><Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}><Box sx={{ px: 1.5, pt: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider', mb: 0.5 }}><ToggleButtonGroup exclusive value={theme} aria-label="Appearance" size="small" onChange={(_event, value) => { if (value) dispatch(uiActions.setTheme(value)); }}>
      <ToggleButton value="light" aria-label="Light theme"><Tooltip title="Light"><LightModeOutlined fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="system" aria-label="System theme"><Tooltip title="System"><SettingsBrightnessOutlined fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="dark" aria-label="Dark theme"><Tooltip title="Dark"><DarkModeOutlined fontSize="small" /></Tooltip></ToggleButton>
    </ToggleButtonGroup></Box><MenuItem onClick={() => { setMenuAnchor(null); setAiOpen(true); }}><AutoAwesomeOutlined sx={{ fontSize: 17, mr: 1 }} />AI assistant</MenuItem><MenuItem onClick={() => { setMenuAnchor(null); setHistoryAnchor(null); dispatch(signOut()); }}><LogoutRounded sx={{ fontSize: 17, mr: 1 }} />Sign out</MenuItem></Menu></Box>
    <Box component="main" className="workspace">{authError && <Alert severity="error" sx={{ mt: 1 }}>{authError}</Alert>}
      <Box className="toolbar"><TextField placeholder="Search songs, artists and albums" aria-label="Search songs" value={search} onChange={event => dispatch(uiActions.setSearch(event.target.value))} className="search" slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment>, endAdornment: search ? <InputAdornment position="end"><IconButton aria-label="Clear search" onClick={() => dispatch(uiActions.setSearch(''))}><CloseRounded sx={{ fontSize: 15 }} /></IconButton></InputAdornment> : undefined } }} />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} className="statistics" aria-live="polite">{data?.demo && <Typography className="demo-label" component="span" color="warning.main" sx={{ fontSize: 10 }}>Demo · fictional songs</Typography>}<Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>Total <b>{stats?.total ?? '—'}</b></Typography><Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>ready <b className="ready-number">{stats?.ready ?? '—'}</b></Typography><Typography component="span" color="text.secondary" sx={{ fontSize: 11 }}>pending <b>{stats?.pending ?? '—'}</b></Typography><Tooltip title="Download history"><IconButton aria-label="Download history" onClick={event => setHistoryAnchor(event.currentTarget)}><HistoryRounded sx={{ fontSize: 20 }} /></IconButton></Tooltip></Stack>
      </Box>
      <Box className="loading-line">{isFetching && <LinearProgress sx={{ height: 2 }} />}</Box>
      {isError && <Alert severity="warning" sx={{ mb: 1 }} action={<Button onClick={() => void refetch()}>Retry</Button>}>{data ? 'Unable to refresh the library. Showing the last available data.' : 'Unable to load the library.'}</Alert>}
      {isLoading || (isFetching && !data) ? <Box className="initial-loading"><CircularProgress size={24} /></Box> : <LibraryTable tracks={data?.tracks ?? []} total={data?.pagination?.total ?? 0} facets={data?.facets} />}
    </Box>
    <AiDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    <HistoryPopover anchor={historyAnchor} onClose={() => setHistoryAnchor(null)} />
    <TrackDetails track={data?.tracks.find(track => track.id === detailsId)} onClose={() => dispatch(uiActions.setDetails(null))} />
  </Box>;
}
