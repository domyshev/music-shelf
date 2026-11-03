import { useEffect, useState } from 'react';
import { Alert, Button, TextField, Tabs, Tab, Dialog, DialogContent, DialogTitle, IconButton, Typography, Box, Tooltip } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import AlbumOutlined from '@mui/icons-material/AlbumOutlined';
import { Status } from './Status';
import type { Track } from '../../shared/catalog';
import { formatSize } from '../format';
import { EntityLink } from './EntityLink';

export function TrackDetails({ track, onClose }: { track?: Track; onClose: () => void }) {
  const file = track?.file;
  const [texts,setTexts]=useState<Record<string,string>>({en:'',ru:'',es:''});
  const [original,setOriginal]=useState('en'); const [language,setLanguage]=useState('en'); const [newLanguage,setNewLanguage]=useState('');
  const [error,setError]=useState(''); const [saved,setSaved]=useState(false); const [loading,setLoading]=useState(false); const [loaded,setLoaded]=useState(false);
  useEffect(()=>{ if(!track) return; const controller=new AbortController(); setTexts({en:'',ru:'',es:''});setOriginal('en');setLanguage('en');setNewLanguage('');setError('');setSaved(false);setLoaded(false);setLoading(true);
    void fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{signal:controller.signal}).then(async r=>{if(!r.ok) throw new Error('Unable to load song text');return r.json();}).then(data=>{setTexts({en:'',ru:'',es:'',...data.texts});setOriginal(data.originalLanguage);setLanguage(data.originalLanguage);setLoaded(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}); return ()=>controller.abort(); },[track?.id]);
  async function save(){if(!track)return;setLoading(true);setError('');setSaved(false);try{const r=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({originalLanguage:original,texts})});if(!r.ok)throw new Error('Unable to save song text');setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setLoading(false);}}
  function addLanguage(){const code=newLanguage.trim().toLowerCase();if(!/^[a-z]{2,3}$/.test(code)){setError('Enter a two- or three-letter language code.');return;}if(!Object.hasOwn(texts,code) && Object.keys(texts).length>=12){setError('You can add up to 12 languages.');return;}setTexts(prev=>({...prev,[code]:prev[code]??''}));setLanguage(code);setNewLanguage('');setError('');setSaved(false);}
  return <Dialog open={Boolean(track)} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle sx={{ pr: 6, pb: 1, fontSize: 18, display: 'flex', alignItems: 'center', gap: 1.5 }}><Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{track?.title}</Box><Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        {track?.status === 'pending' ? <Tooltip title="This file has not been downloaded yet. File details will appear when it is ready." arrow><span tabIndex={0} aria-label="File not downloaded yet" style={{ display: 'inline-flex' }}><Status value="pending" /></span></Tooltip> : track && <Status value="ready" />}
      </Box><IconButton aria-label="Close details" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded fontSize="small" /></IconButton></DialogTitle>
    <DialogContent>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box className="track-metadata-row" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GroupsOutlined sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
          <Box sx={{ minWidth: 0, fontSize: 16, lineHeight: 1.5 }}>{track && <EntityLink kind="artist" name={track.artist} preview />}</Box>
        </Box>
        <Box className="track-metadata-row" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AlbumOutlined sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
          <Box sx={{ minWidth: 0, fontSize: 16, lineHeight: 1.5, color: 'text.secondary' }}>{track?.album ? <EntityLink kind="album" name={track.album} preview /> : <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>Album unknown</Typography>}</Box>
        </Box>
      </Box>
      {file && <Box component="dl" className="file-details">{[
        ['File', file.name], ['Format / codec', `${file.format.toUpperCase()} / ${file.codec}`], ['Quality', `${file.bitDepth || '—'} bits · ${file.sampleRate.toLocaleString('en-GB')} Hz · ${file.channels} channels`], ['Size', `${formatSize(file.sizeBytes)} · ${file.sizeBytes.toLocaleString('en-GB')} bytes`], ['Duration', `${Math.floor(file.durationSeconds / 60)}:${String(Math.floor(file.durationSeconds % 60)).padStart(2, '0')}`], ['Bitrate', `${Math.round(file.bitrateBps / 1000)} kbps`], ['SHA-256', file.sha256],
      ].map(([label, value]) => <Box key={label}><Typography component="dt" color="text.secondary" sx={{ fontSize: 12, opacity: 0.7 }}>{label}</Typography><Typography component="dd" sx={{ fontSize: 14, m: 0, overflowWrap: 'anywhere', fontFamily: label === 'SHA-256' ? 'monospace' : 'inherit' }}>{value}</Typography></Box>)}</Box>}
      <Box sx={{mt:3,display:'flex',flexDirection:'column',gap:2}}>
        <Typography variant="subtitle1">Lyrics and translations</Typography>
        <Tabs value={language} onChange={(_event,value:string)=>setLanguage(value)} variant="scrollable" scrollButtons="auto" aria-label="Lyrics languages">
          {Object.keys(texts).map(code=><Tab key={code} value={code} label={code===original?`${code} · original`:code} aria-label={code===original?`${code} original`:code} />)}
        </Tabs>
        {language==='und' && <Alert severity="info">The language of your previously saved translation is unknown. Copy it to the appropriate language tab.</Alert>}
        <TextField label={language===original?`Lyrics · ${language} · original`:`Lyrics · ${language}`} multiline minRows={5} value={texts[language]??''} disabled={loading||!loaded} onChange={e=>{setTexts(prev=>({...prev,[language]:e.target.value}));setSaved(false);}} fullWidth />
        {language!==original && language!=='und' && <Box><Button size="small" disabled={!loaded||loading} onClick={()=>{setOriginal(language);setSaved(false);}}>Mark {language} as original</Button></Box>}
        <Box sx={{display:'flex',alignItems:'center',gap:1}}><TextField size="small" label="Language code" placeholder="fr" value={newLanguage} onChange={e=>setNewLanguage(e.target.value)} slotProps={{htmlInput:{maxLength:3}}} /><Button disabled={!loaded||loading||!newLanguage.trim()} onClick={addLanguage}>Add language</Button></Box>
        <Box><Button variant="contained" disabled={loading||!loaded} onClick={()=>void save()}>Save lyrics</Button></Box>{saved&&<Alert severity="success">Saved</Alert>}{error&&<Alert severity="error">{error}</Alert>}
      </Box>
    </DialogContent>
  </Dialog>;
}
