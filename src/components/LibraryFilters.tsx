import { useState } from 'react';
import { Autocomplete, Badge, Box, Button, ButtonGroup, Checkbox, IconButton, Menu, MenuItem, Popover, TextField, Tooltip, Typography } from '@mui/material';
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined';
import { uiActions, useAppDispatch, useAppSelector } from '../store';
import { HistoryDateRange } from './HistoryDateRange';

type FilterId = 'status' | 'artist' | 'year';
type Facets = Record<FilterId, string[]>;
const definitions: {id:FilterId;label:string}[] = [{id:'status',label:'Status'},{id:'artist',label:'Artist / band'},{id:'year',label:'Year'}];
const numericFields=[{id:'sampleRate',label:'Sample rate (Hz)'},{id:'bitDepth',label:'Bit depth'},{id:'sizeBytes',label:'Size (bytes)'},{id:'attempts',label:'Attempts'}] as const;
const dateFields=[{id:'queuedAt',label:'Queued at'},{id:'completedAt',label:'Downloaded at'}] as const;

export function LibraryFilters({facets,tags=[]}: {facets?:Facets;tags?:{id:string;name:string}[]}) {
  const dispatch=useAppDispatch();
  const filters=useAppSelector(state=>state.ui.columnFilters);
  const [menuAnchor,setMenuAnchor]=useState<HTMLElement|null>(null);
  const [filterAnchor,setFilterAnchor]=useState<HTMLElement|null>(null);
  const [calendar,setCalendar]=useState<{anchor:HTMLElement;id:'queuedAt'|'completedAt';label:string}|null>(null);
  const reset=()=>dispatch(uiActions.setColumnFilters([]));
  const get=(id:string)=>filters.find(filter=>filter.id===id)?.value;
  const set=(id:string,value:unknown,active:boolean)=>dispatch(uiActions.setColumnFilters([...filters.filter(filter=>filter.id!==id),...(active?[{id,value}]:[])]));
  return <>
    <ButtonGroup size="small" variant="outlined" aria-label="Filter controls" sx={{height:32,flexShrink:0}}>
      <Tooltip title="Configure filters"><IconButton aria-label="Filters" aria-pressed={filters.length>0} onClick={event=>setFilterAnchor(event.currentTarget)} sx={{borderRadius:0}}><Badge color="primary" variant="dot" invisible={!filters.length}><FilterAltOutlined fontSize="small" /></Badge></IconButton></Tooltip>
      <Tooltip title="Filter actions"><IconButton aria-label="Filter actions" onClick={event=>setMenuAnchor(event.currentTarget)} sx={{borderRadius:0,borderLeft:1,borderColor:'divider',px:.25}}><ArrowDropDownRounded fontSize="small" /></IconButton></Tooltip>
    </ButtonGroup>
    <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={()=>setMenuAnchor(null)}>
      <MenuItem disabled={!filters.length} onClick={()=>{reset();setMenuAnchor(null);}}><FilterAltOffOutlined sx={{fontSize:17,mr:1}}/>Reset all filters</MenuItem>
    </Menu>
    <Popover open={Boolean(filterAnchor)} anchorEl={filterAnchor} onClose={()=>setFilterAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'left'}} transformOrigin={{vertical:'top',horizontal:'left'}} slotProps={{paper:{role:'dialog','aria-label':'Configure filters'}}}>
      <Box sx={{width:360,maxWidth:'90vw',maxHeight:'min(75vh, 760px)',overflowY:'auto',p:2,display:'flex',flexDirection:'column',gap:1.5}}>
        <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><Typography sx={{fontWeight:600}}>Filters</Typography><Button size="small" disabled={!filters.length} onClick={reset}>Reset all</Button></Box>
        <TextField label="Song" size="small" value={(get('title') as string)??''} onChange={e=>set('title',e.target.value,Boolean(e.target.value.trim()))} />
        {definitions.map(({id,label})=>{
          const selected=(get(id)??[]) as string[];const options=[...new Set([...(facets?.[id] ?? []),...selected])];
          return <Autocomplete key={id} multiple disableCloseOnSelect size="small" options={options} value={selected} getOptionLabel={value=>value||'Unknown'} onChange={(_event,values)=>set(id,values,Boolean(values.length))}
            renderOption={(props,option,{selected:checked})=>{const {key,...rest}=props;return <li key={key} {...rest}><Checkbox size="small" checked={checked} sx={{p:.5,mr:1}}/>{option||'Unknown'}</li>;}}
            renderInput={params=><TextField {...params} label={label}/>}/>;
        })}
        <Autocomplete multiple disableCloseOnSelect size="small" options={tags.map(tag=>tag.id)} value={(get('tags')??[]) as string[]} getOptionLabel={id=>tags.find(tag=>tag.id===id)?.name??id} onChange={(_event,values)=>set('tags',values,Boolean(values.length))} renderInput={params=><TextField {...params} label="Tags"/>}/>
        {numericFields.map(({id,label})=>{const range=(get(id)??{}) as {min?:string;max?:string};return <Box key={id}><Typography sx={{fontSize:12,mb:.5}}>{label}</Typography><Box sx={{display:'flex',gap:1}}>{(['min','max'] as const).map(bound=><TextField key={bound} size="small" label={bound==='min'?'From':'To'} type="number" value={range[bound]??''} slotProps={{htmlInput:{min:0,step:'any','aria-label':`${label} ${bound}`}}} onChange={e=>{const next={...range,[bound]:e.target.value};set(id,next,Boolean(next.min||next.max));}} fullWidth />)}</Box></Box>;})}
        {dateFields.map(({id,label})=>{const value=(get(id)??{}) as {start?:string;end?:string};return <Button key={id} variant="outlined" aria-label={`${label} date range`} onClick={e=>setCalendar({anchor:e.currentTarget,id,label})} sx={{justifyContent:'space-between'}}>{label}: {value.start||value.end?`${value.start||'…'} — ${value.end||'…'}`:'Any date'}</Button>;})}
      </Box>
    </Popover>
    {calendar&&<HistoryDateRange key={calendar.id} anchor={calendar.anchor} title={`${calendar.label} date range`} start={((get(calendar.id)??{}) as {start?:string}).start??''} end={((get(calendar.id)??{}) as {end?:string}).end??''} onClose={()=>setCalendar(null)} onApply={(start,end)=>set(calendar.id,{start,end},Boolean(start||end))} />}
  </>;
}
