import { useEffect, useState } from 'react';
import { Alert, Box, Button, ButtonBase, FormControl, IconButton, InputLabel, Menu, MenuItem, Popover, Select, TextField, Tooltip, Typography } from '@mui/material';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import AlbumOutlined from '@mui/icons-material/AlbumOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { Status } from './Status';
import type { Track } from '../../shared/catalog';
import { formatSize } from '../format';
import { EntityLink } from './EntityLink';
import { WindowFrame } from './WindowFrame';

export function TrackDetails({ track, onClose }: { track?: Track; onClose: () => void }) {
  const file=track?.file;
  const [texts,setTexts]=useState<Record<string,string>>({en:'',ru:'',es:''});
  const [original,setOriginal]=useState('en');const [selected,setSelected]=useState<string[]>(['en']);const [newLanguage,setNewLanguage]=useState('');
  const [addAnchor,setAddAnchor]=useState<HTMLElement|null>(null);const [menuAnchor,setMenuAnchor]=useState<HTMLElement|null>(null);const [settingsAnchor,setSettingsAnchor]=useState<HTMLElement|null>(null);
  const [error,setError]=useState('');const [saved,setSaved]=useState(false);const [loading,setLoading]=useState(false);const [loaded,setLoaded]=useState(false);
  useEffect(()=>{if(!track){setAddAnchor(null);setMenuAnchor(null);setSettingsAnchor(null);return;}const controller=new AbortController();setTexts({en:'',ru:'',es:''});setOriginal('en');setSelected(['en']);setNewLanguage('');setError('');setSaved(false);setLoaded(false);setLoading(true);
    void fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Unable to load song text');return r.json();}).then(data=>{setTexts({en:'',ru:'',es:'',...data.texts});setOriginal(data.originalLanguage);setSelected([data.originalLanguage]);setLoaded(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[track?.id]);
  async function save(){if(!track)return;setLoading(true);setError('');setSaved(false);try{const r=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({originalLanguage:original,texts})});if(!r.ok)throw new Error('Unable to save song text');setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setLoading(false);}}
  function addLanguage(){const code=newLanguage.trim().toLowerCase();if(!/^[a-z]{2,3}$/.test(code)){setError('Enter a two- or three-letter language code.');return;}if(!Object.hasOwn(texts,code)&&Object.keys(texts).length>=12){setError('You can add up to 12 languages.');return;}setTexts(prev=>({...prev,[code]:prev[code]??''}));setSelected(prev=>prev.includes(code)?prev:[...prev,code]);setNewLanguage('');setError('');setSaved(false);setAddAnchor(null);}
  function toggleLanguage(code:string){setSelected(prev=>prev.includes(code)?prev.length===1?prev:prev.filter(item=>item!==code):[...prev,code]);}
  const title=<Box sx={{display:'flex',alignItems:'center',gap:1,flexWrap:'wrap'}}><span>{track?.title}</span>{track&&<Status value={track.status} />}</Box>;
  return <WindowFrame open={Boolean(track)} onClose={onClose} id="song" defaultPlacement="modal" title={title}>
    <Box className="song-details-body">
      <Box className="song-metadata">
        <Box className="track-metadata-row" sx={{display:'flex',alignItems:'center',gap:1}}><GroupsOutlined sx={{fontSize:17,color:'text.secondary',flexShrink:0}} /><Box sx={{minWidth:0,fontSize:16,lineHeight:1.5}}>{track&&<EntityLink kind="artist" name={track.artist} preview />}</Box></Box>
        <Box className="track-metadata-row" sx={{display:'flex',alignItems:'center',gap:1}}><AlbumOutlined sx={{fontSize:17,color:'text.secondary',flexShrink:0}} /><Box sx={{minWidth:0,fontSize:16,lineHeight:1.5,color:'text.secondary'}}>{track?.album?<EntityLink kind="album" name={track.album} preview />:<Typography sx={{fontSize:'inherit'}}>Album unknown</Typography>}</Box></Box>
        {file&&<Box component="dl" className="file-details">{[['File',file.name],['Format / codec',`${file.format.toUpperCase()} / ${file.codec}`],['Quality',`${file.bitDepth||'—'} bits · ${file.sampleRate.toLocaleString('en-GB')} Hz · ${file.channels} channels`],['Size',`${formatSize(file.sizeBytes)} · ${file.sizeBytes.toLocaleString('en-GB')} bytes`],['Duration',`${Math.floor(file.durationSeconds/60)}:${String(Math.floor(file.durationSeconds%60)).padStart(2,'0')}`],['Bitrate',`${Math.round(file.bitrateBps/1000)} kbps`],['SHA-256',file.sha256]].map(([label,value])=><Box key={label}><Typography component="dt" color="text.secondary" sx={{fontSize:12,opacity:.7}}>{label}</Typography><Typography component="dd" sx={{fontSize:14,m:0,overflowWrap:'anywhere',fontFamily:label==='SHA-256'?'monospace':'inherit'}}>{value}</Typography></Box>)}</Box>}
      </Box>
      <Box className="lyrics-section">
        <Typography variant="subtitle1">Lyrics and translations</Typography>
        <Box className="lyrics-toolbar"><Box role="tablist" aria-label="Lyrics languages" aria-multiselectable="true" className="lyrics-tabs">{Object.keys(texts).map(code=><Tooltip key={code} describeChild title={code===original?'Original language':''}><ButtonBase role="tab" aria-selected={selected.includes(code)} className={`lyrics-tab${selected.includes(code)?' selected':''}${code===original?' original':''}`} onClick={()=>toggleLanguage(code)}>{code}</ButtonBase></Tooltip>)}</Box>
          <Tooltip title="Add language"><span><IconButton aria-label="Add language" disabled={!loaded||loading} onClick={e=>setAddAnchor(e.currentTarget)}><AddRounded /></IconButton></span></Tooltip>
          <Tooltip title="Language menu"><IconButton aria-label="Language menu" onClick={e=>setMenuAnchor(e.currentTarget)}><MoreVertRounded /></IconButton></Tooltip>
        </Box>
        <Popover open={Boolean(addAnchor)} anchorEl={addAnchor} onClose={()=>setAddAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}><Box sx={{p:2,display:'flex',gap:1,alignItems:'center'}}><TextField autoFocus size="small" label="Language code" placeholder="fr" value={newLanguage} onChange={e=>setNewLanguage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addLanguage();}}} slotProps={{htmlInput:{maxLength:3}}}/><Button onClick={addLanguage} disabled={!newLanguage.trim()}>Add</Button></Box></Popover>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={()=>setMenuAnchor(null)}><MenuItem onClick={()=>{setSettingsAnchor(menuAnchor);setMenuAnchor(null);}}><SettingsOutlined sx={{fontSize:18,mr:1}}/>Settings</MenuItem></Menu>
        <Popover open={Boolean(settingsAnchor)} anchorEl={settingsAnchor} onClose={()=>setSettingsAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}><Box sx={{p:2,minWidth:180}}><FormControl fullWidth size="small"><InputLabel id="original-language-label">Default language</InputLabel><Select labelId="original-language-label" label="Default language" value={original} onChange={e=>{setOriginal(e.target.value);setSaved(false);}}>{Object.keys(texts).filter(code=>code!=='und').map(code=><MenuItem key={code} value={code}>{code}</MenuItem>)}</Select></FormControl></Box></Popover>
        <Box className="lyrics-scroll" data-testid="lyrics-scroll"><Box className="lyrics-columns" sx={{minWidth:selected.length*240}}>{Object.keys(texts).filter(code=>selected.includes(code)).map(code=><Box className="lyrics-column" key={code}>{selected.length>1&&<Box className="lyrics-column-heading" aria-hidden="true">{code}</Box>}<Box className="lyrics-column-body"><Box aria-hidden="true" className="lyrics-mirror">{texts[code]||' '}{'\n'}</Box><textarea aria-label={`Lyrics ${code}`} className="lyrics-editor" placeholder={code==='und'?'Unknown language':code} value={texts[code]??''} disabled={loading||!loaded} onChange={e=>{setTexts(prev=>({...prev,[code]:e.target.value}));setSaved(false);}} /></Box></Box>)}</Box></Box>
        <Box className="lyrics-footer"><Button variant="contained" disabled={loading||!loaded} onClick={()=>void save()}>Save lyrics</Button>{saved&&<Typography color="success.main" variant="caption">Saved</Typography>}{error&&<Alert severity="error">{error}</Alert>}</Box>
      </Box>
    </Box>
  </WindowFrame>;
}
