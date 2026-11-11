import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Checkbox, Chip, IconButton, List, ListItemButton, ListItemText, Popover, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, TablePagination, Tooltip, Typography } from '@mui/material';
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Track } from '../../shared/catalog';
import { pageSizeOptions, uiActions, useAppDispatch, useAppSelector } from '../store';
import { formatDate, formatRate, formatSize } from '../format';
import { Status } from './Status';
import { OverflowTooltip } from './OverflowTooltip';
import { EntityLink } from './EntityLink';

const helper = createColumnHelper<Track>();
const filterIds = new Set(['status', 'artist', 'year']);
const rightAligned = new Set(['sampleRate', 'bitDepth', 'sizeBytes', 'year', 'attempts']);
export function LibraryTable({ tracks, total, facets, tagsByTrack }: { tracks: Track[]; total: number; facets?: { status: string[]; artist: string[]; year: string[] }; tagsByTrack?: Record<string,{id:string;name:string}[]> }) {
  const dispatch = useAppDispatch();
  const { sorting, columnOrder, columnSizing, columnVisibility, columnFilters, page, pageSize } = useAppSelector(state => state.ui);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; target: string; x: number; moved: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ element: HTMLElement; id: string } | null>(null);
  const columns = useMemo(() => [
    helper.accessor('status', { header: 'Status', size: 108, cell: info => <Status value={info.getValue()} /> }),
    helper.accessor('attempts', { header: 'Attempts', size: 95, sortUndefined: 'last', cell: info => info.getValue() ?? '—' }),
    helper.accessor('title', { header: 'Song', size: 350, minSize: 120, cell: info => <OverflowTooltip text={info.getValue()}><ButtonBase className="song-name" onClick={() => dispatch(uiActions.setDetails(info.row.original.id))}>{info.getValue()}</ButtonBase></OverflowTooltip> }),
    helper.accessor('artist', { header: 'Artist / band', size: 250, cell: info => <OverflowTooltip text={info.getValue()}><EntityLink kind="artist" name={info.getValue()} ellipsis /></OverflowTooltip> }),
    helper.accessor('year', { header: 'Year', size: 112, cell: info => info.getValue() ?? '—' }),
    helper.accessor(row => row.file?.sampleRate ?? undefined, { id: 'sampleRate', header: 'kHz', size: 82, sortUndefined: 'last', cell: info => formatRate(info.getValue()) }),
    helper.accessor(row => row.file?.bitDepth || undefined, { id: 'bitDepth', header: 'Bits', size: 72, sortUndefined: 'last', cell: info => info.getValue() ?? '—' }),
    helper.accessor(row => row.file?.sizeBytes ?? undefined, { id: 'sizeBytes', header: 'Size', size: 110, sortUndefined: 'last', cell: info => formatSize(info.getValue()) }),
    helper.display({ id: 'tags', header: 'Tags', size: 220, enableSorting: false, cell: info => { const tags=tagsByTrack?.[info.row.original.id] ?? []; return tags.length ? <Tooltip arrow title={tags.map(tag=>tag.name).join(', ')}><Box sx={{display:'flex',gap:.5,overflow:'hidden'}}>{tags.map(tag=><Chip key={tag.id} size="small" variant="outlined" label={tag.name} sx={{height:23,maxWidth:'100%',fontSize:11}} />)}</Box></Tooltip> : '—'; } }),
    helper.accessor('queuedAt', { header: 'Queued at', size: 175, sortUndefined: 'last', cell: info => info.getValue() ? formatDate(info.getValue()!) : '—' }),
    helper.accessor('completedAt', { header: 'Downloaded at', size: 175, sortUndefined: 'last', cell: info => info.getValue() ? formatDate(info.getValue()!) : '—' }),
  ], [dispatch,tagsByTrack]);
  const table = useReactTable({
    data: tracks, columns, defaultColumn: { minSize: 64, maxSize: 1200, filterFn: (row, id, selected: string[]) => selected.includes(String(row.getValue(id) ?? '')) },
    state: { sorting, columnOrder, columnSizing, columnVisibility, columnFilters }, manualFiltering: true, manualSorting: true, manualPagination: true, rowCount: total, enableMultiSort: false, getRowId: row => row.id,
    columnResizeMode: 'onChange',
    onColumnSizingChange: update => dispatch(uiActions.setColumnSizing(typeof update === 'function' ? update(columnSizing) : update)),
    onColumnFiltersChange: update => dispatch(uiActions.setColumnFilters(typeof update === 'function' ? update(columnFilters) : update)),
    onSortingChange: update => dispatch(uiActions.setSorting(typeof update === 'function' ? update(sorting) : update)),
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 36, overscan: 12, getItemKey: index => rows[index].id });
  useEffect(() => { virtual.scrollToOffset(0); }, [page, pageSize, sorting, columnFilters]);
  const items = virtual.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtual.getTotalSize() - (items.at(-1)?.end ?? 0);
  function moveColumn(source: string, target: string) {
    if (source === target) return;
    const order = columnOrder.filter(id => id !== source);
    order.splice(columnOrder.indexOf(target), 0, source);
    dispatch(uiActions.setColumnOrder(order));
  }
  const available = useMemo(() => {
    const id = filterAnchor?.id;
    if (!id) return [];
    return facets?.[id as 'status' | 'artist' | 'year'] ?? [];
  }, [facets, filterAnchor?.id]);
  const activeColumn = filterAnchor ? table.getColumn(filterAnchor.id) : undefined;
  const selected = (activeColumn?.getFilterValue() ?? []) as string[];
  return <Box className="table-shell">
    <Box ref={scrollRef} className="table-scroll" data-testid="library-scroll" tabIndex={0} aria-label="Song library">
      <Table size="small" stickyHeader aria-label="Songs" aria-rowcount={rows.length + 1} sx={{ tableLayout: 'fixed', width: table.getTotalSize(), minWidth: '100%' }}>
        <colgroup>{table.getVisibleLeafColumns().map(column => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>
        <TableHead>{table.getHeaderGroups().map(group => <TableRow key={group.id}>{group.headers.map(header => {
          const id = header.column.id;
          const align = rightAligned.has(id) ? 'right' : 'left';
          return <TableCell key={header.id} data-column={id} align={align} sortDirection={header.column.getIsSorted() || false} className={`column-heading ${dropTarget === id ? 'drop-target' : ''}`} sx={{ height: 34, p: 0 }}
>
            <div className={`header-content align-${align} ${filterIds.has(id) ? 'filterable' : ''}`}>
              <button className="column-grip" aria-label={`Move column ${header.column.columnDef.header}`}
                onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { id, target: id, x: event.clientX, moved: false }; }}
                onPointerMove={event => {
                  const drag = dragRef.current;
                  if (!drag) return;
                  drag.moved ||= Math.abs(event.clientX - drag.x) > 4;
                  if (!drag.moved) return;
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-column]')?.getAttribute('data-column');
                  if (target) { drag.target = target; setDropTarget(target); }
                }}
                onPointerUp={event => { const drag = dragRef.current; if (drag?.moved) moveColumn(drag.id, drag.target); dragRef.current = null; setDropTarget(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { dragRef.current = null; setDropTarget(null); }}
                onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const neighbor = columnOrder[columnOrder.indexOf(id) + (event.key === 'ArrowLeft' ? -1 : 1)]; if (neighbor) moveColumn(id, neighbor); } }}><span className="six-dots" /></button>
              {header.column.getCanSort() ? <TableSortLabel className="header-sort" active={!!header.column.getIsSorted()} direction={header.column.getIsSorted() || 'asc'} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}</TableSortLabel> : <span className="header-sort">{flexRender(header.column.columnDef.header, header.getContext())}</span>}
              {filterIds.has(id) && <IconButton aria-label={`Filter: ${header.column.columnDef.header}`} aria-pressed={header.column.getIsFiltered()} className={`column-filter ${header.column.getIsFiltered() ? 'active' : ''}`} onClick={event => setFilterAnchor({ element: event.currentTarget, id })}><FilterAltOutlined sx={{ fontSize: 15 }} /></IconButton>}
              <div role="separator" aria-label={`Column width: ${header.column.columnDef.header}`} aria-orientation="vertical" aria-valuenow={header.column.getSize()} aria-valuemin={header.column.columnDef.minSize ?? 64} aria-valuemax={1200} tabIndex={0} className={`column-resizer ${header.column.getIsResizing() ? 'resizing' : ''}`} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} onDoubleClick={() => header.column.resetSize()} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); dispatch(uiActions.setColumnSizing({ ...columnSizing, [id]: Math.max(header.column.columnDef.minSize ?? 64, Math.min(1200, header.column.getSize() + (event.key === 'ArrowRight' ? 16 : -16))) })); } }} />
            </div>
          </TableCell>;
        })}</TableRow>)}</TableHead>
        <TableBody>
          {paddingTop > 0 && <TableRow aria-hidden="true"><TableCell colSpan={table.getVisibleLeafColumns().length} sx={{ height: paddingTop, p: 0, border: 0 }} /></TableRow>}
          {items.map(item => { const row = rows[item.index]; return <TableRow key={row.id} hover aria-rowindex={item.index + 2} data-testid="track-row" sx={{ height: 36 }}>{row.getVisibleCells().map(cell => <TableCell key={cell.id} align={rightAligned.has(cell.column.id) ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', height: 36, py: 0, fontVariantNumeric: 'tabular-nums' }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>; })}
          {paddingBottom > 0 && <TableRow aria-hidden="true"><TableCell colSpan={table.getVisibleLeafColumns().length} sx={{ height: paddingBottom, p: 0, border: 0 }} /></TableRow>}
        </TableBody>
      </Table>
      {rows.length === 0 && <Box className="empty-state"><Typography sx={{ fontWeight: 600 }}>No songs found</Typography><Typography variant="body2" color="text.secondary">Try a different search or clear the filters.</Typography></Box>}
    </Box>
    <TablePagination component="div" count={total} page={Math.min(page - 1, Math.max(0, Math.ceil(total / pageSize) - 1))} rowsPerPage={pageSize} rowsPerPageOptions={pageSizeOptions} onPageChange={(_event, next) => dispatch(uiActions.setPage(next + 1))} onRowsPerPageChange={event => dispatch(uiActions.setPageSize(Number(event.target.value)))} sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', '& .MuiToolbar-root': { minHeight: 38 }, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: 11 }, '& .MuiTablePagination-actions': { ml: 1 } }} />
    <Popover open={Boolean(filterAnchor)} anchorEl={filterAnchor?.element} onClose={() => setFilterAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box sx={{ width: 280, maxWidth: '90vw' }}><Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{String(activeColumn?.columnDef.header ?? '')}</Typography><Button onClick={() => activeColumn?.setFilterValue(undefined)} disabled={!selected.length}>Clear</Button></Box>
        <List dense sx={{ maxHeight: 320, overflow: 'auto', py: 0.5 }} aria-label="Filter values">{available.map(value => <ListItemButton key={value} selected={selected.includes(value)} onClick={() => { const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]; activeColumn?.setFilterValue(next.length ? next : undefined); }}><Checkbox size="small" checked={selected.includes(value)} tabIndex={-1} disableRipple sx={{ p: 0.5, mr: 1 }} /><ListItemText primary={value || 'Unknown'} slotProps={{ primary: { sx: { fontSize: 12 } } }} /></ListItemButton>)}</List>
      </Box>
    </Popover>
  </Box>;
}
