import { useState } from 'react';
import { Box, Checkbox, IconButton, List, ListItemButton, ListItemText, Popover, Tooltip, Typography } from '@mui/material';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import { columnIds, uiActions, useAppDispatch, useAppSelector } from '../store';

const labels:Record<string,string>={status:'Status',title:'Song',artist:'Artist / band',year:'Year',sampleRate:'kHz',bitDepth:'Bits',sizeBytes:'Size',attempts:'Attempts',tags:'Tags'};
export function ColumnChooser() {
  const [anchor,setAnchor]=useState<HTMLElement|null>(null);const dispatch=useAppDispatch();
  const {columnOrder,columnVisibility}=useAppSelector(state=>state.ui);
  const order=[...columnOrder,...columnIds.filter(id=>!columnOrder.includes(id))];
  return <><Tooltip title="Choose columns"><IconButton aria-label="Choose columns" onClick={event=>setAnchor(event.currentTarget)}><ViewColumnOutlined sx={{fontSize:20}} /></IconButton></Tooltip>
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={()=>setAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}>
      <Box sx={{minWidth:180}}><Typography sx={{px:2,pt:1.5,fontWeight:600}}>Columns</Typography><List dense>{order.map(id=><ListItemButton key={id} onClick={()=>dispatch(uiActions.setColumnVisibility({...columnVisibility,[id]:columnVisibility[id]===false}))}><Checkbox size="small" checked={columnVisibility[id]!==false} tabIndex={-1} disableRipple sx={{p:.5,mr:1}}/><ListItemText primary={labels[id]} slotProps={{primary:{sx:{fontSize:12}}}}/></ListItemButton>)}</List></Box>
    </Popover></>;
}
