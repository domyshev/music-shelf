import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControl, IconButton, InputLabel, MenuItem, Popover, Select, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { useVirtualizer } from '@tanstack/react-virtual';
import DateRangeRounded from '@mui/icons-material/DateRangeRounded';
import { eventKinds, type EventKind } from '../../shared/catalog';
import { eventLabels as labels, historyRequestFilters, emptyHistorySelection } from '../historyFilters';
import { HistoryDateRange } from './HistoryDateRange';
import { OverflowTooltip } from './OverflowTooltip';
import { historyActions, useAppDispatch, useAppSelector, useLazyHistoryQuery } from '../store';
export function HistoryPopover({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const { generation, events, nextCursor, loaded, total, filters } = useAppSelector(state => state.history);
  const [fetchPage, { isFetching, isError }] = useLazyHistoryQuery();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);
  const requestFilters = useMemo(() => historyRequestFilters(filters), [filters]);
  const close = () => { setCalendarAnchor(null); onClose(); };
  useEffect(() => {
    if (!anchor) return;
    const current = crypto.randomUUID(); dispatch(historyActions.opened(current));
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const request = fetchPage({ generation: current, filters: requestFilters });
    return () => request.abort();
  }, [anchor, dispatch, fetchPage, requestFilters]);
  const virtual = useVirtualizer({ count: events.length, getScrollElement: () => scrollRef.current, estimateSize: () => 46, overscan: 8, getItemKey: index => events[index].id, enabled: Boolean(anchor) });
  const items = virtual.getVirtualItems();
  const loadMore = () => { if (loaded && generation && !isFetching && nextCursor) void fetchPage({ cursor: nextCursor, generation, filters: requestFilters }); };
  return <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 720, maxWidth: 'calc(100vw - 24px)', borderRadius: 2, border: '1px solid', borderColor: 'divider', mt: 1 } } }}>
    <Box className="history-heading"><Box><Typography component="h2" sx={{ fontSize: 14, fontWeight: 650 }}>Library history</Typography><Typography aria-live="polite" color="text.secondary" sx={{ fontSize: 11 }}>Records: {loaded ? total : '—'} · loaded: {events.length}</Typography></Box><IconButton aria-label="Close history" onClick={close}><CloseRounded fontSize="small" /></IconButton></Box>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <FormControl size="small" sx={{ width: 225 }}>
        <InputLabel shrink id="history-event-filter-label">Event</InputLabel>
        <Select multiple labelId="history-event-filter-label" label="Event" value={filters.kinds} displayEmpty inputProps={{ 'aria-label': 'Filter history events' }}
          renderValue={values => values.length ? values.map(value => labels[value]).join(', ') : 'All events'}
          onChange={event => { const value = event.target.value; dispatch(historyActions.setFilters({ ...filters, kinds: (typeof value === 'string' ? value.split(',') : value) as EventKind[] })); }}
          sx={{ fontSize: 11, height: 32 }}>
          {eventKinds.map(kind => <MenuItem key={kind} value={kind} sx={{ fontSize: 12 }}><Checkbox size="small" checked={filters.kinds.includes(kind)} sx={{ p: 0.5, mr: 1 }} />{labels[kind]}</MenuItem>)}
        </Select>
      </FormControl>
      <Button startIcon={<DateRangeRounded sx={{ fontSize: 16 }} />} variant={filters.start || filters.end ? 'outlined' : 'text'} aria-label="History date range" onClick={event => setCalendarAnchor(event.currentTarget)} sx={{ fontSize: 11 }}>
        {filters.start || filters.end ? `${filters.start ? new Date(`${filters.start}T12:00:00`).toLocaleDateString('en-GB') : '…'} — ${filters.end ? new Date(`${filters.end}T12:00:00`).toLocaleDateString('en-GB') : '…'}` : 'All dates'}
      </Button>
      {(filters.kinds.length > 0 || filters.start || filters.end) && <Button sx={{ fontSize: 11, ml: 'auto' }} onClick={() => dispatch(historyActions.setFilters(emptyHistorySelection))}>Clear filters</Button>}
    </Box>
    {anchor && calendarAnchor && <HistoryDateRange anchor={calendarAnchor} start={filters.start} end={filters.end} onClose={() => setCalendarAnchor(null)} onApply={(start, end) => dispatch(historyActions.setFilters({ ...filters, start, end }))} />}
    <Box ref={scrollRef} className="history-scroll" data-testid="history-scroll" onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) loadMore(); }}>
      <Table size="small" stickyHeader aria-label="Download history" sx={{ tableLayout: 'fixed', minWidth: 650 }}>
        <TableHead><TableRow><TableCell sx={{ width: 92 }}>Date</TableCell><TableCell sx={{ width: 80 }}>Time</TableCell><TableCell>Song</TableCell><TableCell sx={{ width: 160 }}>Event</TableCell></TableRow></TableHead>
        <TableBody>
          {(items[0]?.start ?? 0) > 0 && <TableRow aria-hidden="true"><TableCell colSpan={4} sx={{ height: items[0].start, p: 0, border: 0 }} /></TableRow>}
          {items.map(item => { const event = events[item.index]; return <TableRow key={event.id} data-testid="history-row" sx={{ height: 46 }}><TableCell sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', py: 0 }}><Tooltip title={`${event.occurredAt}${event.timeBasis === 'observed' ? ' · observation time' : event.timeBasis === 'import' ? ' · import time; download date unknown' : ''}`}><span>{new Date(event.occurredAt).toLocaleDateString('en-GB')}</span></Tooltip></TableCell><TableCell sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', py: 0 }}>{new Date(event.occurredAt).toLocaleTimeString('en-GB')}</TableCell><TableCell sx={{ py: 0 }}><OverflowTooltip text={event.title} /><OverflowTooltip text={event.artist} className="history-artist" /></TableCell><TableCell sx={{ fontSize: 11, py: 0, color: event.kind === 'downloaded' ? 'success.main' : 'text.secondary' }}>{labels[event.kind]}</TableCell></TableRow>; })}
          {events.length > 0 && <TableRow aria-hidden="true"><TableCell colSpan={4} sx={{ height: Math.max(0, virtual.getTotalSize() - (items.at(-1)?.end ?? 0)), p: 0, border: 0 }} /></TableRow>}
        </TableBody>
      </Table>
      {!loaded && isFetching && <Box className="history-message"><CircularProgress size={20} /></Box>}
      {loaded && !events.length && <Box className="history-message"><Typography color="text.secondary" sx={{ fontSize: 12 }}>No events found.</Typography></Box>}
      {isError && <Alert severity="error" action={<Button onClick={() => void fetchPage({ cursor: loaded ? nextCursor ?? undefined : undefined, generation, filters: requestFilters })}>Retry</Button>}>Unable to load history</Alert>}
      {nextCursor && <Box className="history-load"><Button disabled={isFetching} onClick={loadMore}>{isFetching ? 'Loading…' : 'Earlier events'}</Button></Box>}
    </Box>
  </Popover>;
}
