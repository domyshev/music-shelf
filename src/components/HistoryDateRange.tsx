import { useState } from 'react';
import { Box, Button, IconButton, Popover, TextField, Typography } from '@mui/material';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { isCalendarDate, localDate } from '../historyFilters';

export function HistoryDateRange({ anchor, start, end, onClose, onApply }: { anchor: HTMLElement; start: string; end: string; onClose: () => void; onApply: (start: string, end: string) => void }) {
  const [draftStart, setStart] = useState(start);
  const [draftEnd, setEnd] = useState(end);
  const [month, setMonth] = useState(() => { const date = start ? new Date(`${start}T12:00:00`) : new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const valid = (!draftStart || isCalendarDate(draftStart)) && (!draftEnd || isCalendarDate(draftEnd)) && (!draftStart || !draftEnd || draftStart <= draftEnd);
  function choose(value: string) {
    if (!draftStart || draftEnd) { setStart(value); setEnd(''); }
    else if (value < draftStart) { setStart(value); setEnd(draftStart); }
    else setEnd(value);
  }
  return <Popover open anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
    <Box sx={{ width: 310, maxWidth: 'calc(100vw - 24px)', p: 1.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1 }}>Event date range</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField label="From" type="date" value={draftStart} onChange={event => setStart(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': 'From' } }} sx={{ flex: 1, '& input': { fontSize: 11, px: 1 } }} />
        <TextField label="To" type="date" value={draftEnd} onChange={event => setEnd(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': 'To' } }} sx={{ flex: 1, '& input': { fontSize: 11, px: 1 } }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <IconButton aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeftRounded fontSize="small" /></IconButton>
        <Typography sx={{ fontSize: 12 }}>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</Typography>
        <IconButton aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRightRounded fontSize="small" /></IconButton>
      </Box>
      <Box role="group" aria-label="Date range calendar" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', mt: 0.5 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <Typography key={day} sx={{ textAlign: 'center', fontSize: 10, py: 0.5, color: 'text.secondary' }}>{day}</Typography>)}
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
          const value = localDate(date);
          const selected = value === draftStart || value === draftEnd;
          const inRange = draftStart && draftEnd && value > draftStart && value < draftEnd;
          return <Button key={value} aria-label={date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={selected} variant={selected ? 'contained' : 'text'} onClick={() => choose(value)} sx={{ minWidth: 0, height: 30, p: 0, fontSize: 11, borderRadius: 1, bgcolor: inRange ? 'action.selected' : undefined }}>{index + 1}</Button>;
        })}
      </Box>
      {!valid && <Typography color="error" sx={{ fontSize: 11, mt: 1 }}>Check the start and end dates.</Typography>}
      <Typography color="text.secondary" sx={{ fontSize: 10, mt: 1 }}>Inclusive dates · local time</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}><Button onClick={() => { onApply('', ''); onClose(); }}>Clear dates</Button><Button variant="contained" disabled={!valid} onClick={() => { onApply(draftStart, draftEnd || draftStart); onClose(); }}>Apply</Button></Box>
    </Box>
  </Popover>;
}
