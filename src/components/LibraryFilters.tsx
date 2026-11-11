import { useState } from 'react';
import { Autocomplete, Badge, Box, Button, Checkbox, IconButton, Menu, MenuItem, Popover, TextField, Tooltip, Typography } from '@mui/material';
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined';
import { uiActions, useAppDispatch, useAppSelector } from '../store';

type FilterId = 'status' | 'artist' | 'year';
type Facets = Record<FilterId, string[]>;
const definitions: {id:FilterId;label:string}[] = [{id:'status',label:'Status'},{id:'artist',label:'Artist / band'},{id:'year',label:'Year'}];

export function LibraryFilters({facets}: {facets?:Facets}) {
  const dispatch=useAppDispatch();
  const filters=useAppSelector(state=>state.ui.columnFilters);
  const [menuAnchor,setMenuAnchor]=useState<HTMLElement|null>(null);
  const [filterAnchor,setFilterAnchor]=useState<HTMLElement|null>(null);
  const reset=()=>dispatch(uiActions.setColumnFilters([]));
  return <>
    <Tooltip title="Filters"><IconButton aria-label="Filters" aria-pressed={filters.length>0} onClick={event=>setMenuAnchor(event.currentTarget)}><Badge color="primary" variant="dot" invisible={!filters.length}><FilterAltOutlined fontSize="small" /></Badge></IconButton></Tooltip>
    <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={()=>setMenuAnchor(null)}>
      <MenuItem onClick={()=>{setFilterAnchor(menuAnchor);setMenuAnchor(null);}}><SettingsOutlined sx={{fontSize:17,mr:1}}/>Configure filters</MenuItem>
      <MenuItem disabled={!filters.length} onClick={()=>{reset();setMenuAnchor(null);}}><FilterAltOffOutlined sx={{fontSize:17,mr:1}}/>Reset all filters</MenuItem>
    </Menu>
    <Popover open={Boolean(filterAnchor)} anchorEl={filterAnchor} onClose={()=>setFilterAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'left'}} transformOrigin={{vertical:'top',horizontal:'left'}} slotProps={{paper:{role:'dialog','aria-label':'Configure filters'}}}>
      <Box sx={{width:340,maxWidth:'90vw',p:2,display:'flex',flexDirection:'column',gap:1.5}}>
        <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><Typography sx={{fontWeight:600}}>Filters</Typography><Button size="small" disabled={!filters.length} onClick={reset}>Reset all</Button></Box>
        {definitions.map(({id,label})=>{
          const selected=(filters.find(filter=>filter.id===id)?.value ?? []) as string[];
          const options=[...new Set([...(facets?.[id] ?? []),...selected])];
          return <Autocomplete key={id} multiple disableCloseOnSelect size="small" options={options} value={selected} getOptionLabel={value=>value||'Unknown'}
            onChange={(_event,values)=>dispatch(uiActions.setColumnFilters([...filters.filter(filter=>filter.id!==id),...(values.length?[{id,value:values}]:[])]))}
            renderOption={(props,option,{selected:checked})=>{const {key,...rest}=props;return <li key={key} {...rest}><Checkbox size="small" checked={checked} sx={{p:.5,mr:1}}/>{option||'Unknown'}</li>;}}
            renderInput={params=><TextField {...params} label={label}/>}/>
        })}
      </Box>
    </Popover>
  </>;
}
