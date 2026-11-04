import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, FormControl, IconButton, MenuItem, Paper, Popover, Popper, Select, TextField, Tooltip, Typography } from '@mui/material';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import AlbumOutlined from '@mui/icons-material/AlbumOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckBoxRounded from '@mui/icons-material/CheckBoxRounded';
import CheckBoxOutlineBlankRounded from '@mui/icons-material/CheckBoxOutlineBlankRounded';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Status } from './Status';
import type { Track } from '../../shared/catalog';
import { formatSize } from '../format';
import { EntityLink } from './EntityLink';
import { WindowFrame } from './WindowFrame';

const languageNames = new Intl.DisplayNames(['en'], {type:'language'});
const preferredLanguages = ['ru','es','en'];
const languageLabel = (code:string) => { const name=languageNames.of(code) ?? code; return name.charAt(0).toUpperCase()+name.slice(1); };
const readMetadataHeight = () => { try { const value=Number(localStorage.getItem('music-shelf-song-metadata-height')); return Number.isFinite(value)&&value>=80&&value<=2000?value:undefined; } catch { return undefined; } };
const languageCodes = Array.from({length:26*26},(_,i)=>String.fromCharCode(97+Math.floor(i/26),97+i%26)).filter(code=>languageNames.of(code)!==code);

export function TrackDetails({ track, onClose }: { track?: Track; onClose: () => void }) {
  const file=track?.file;
  const [texts,setTexts]=useState<Record<string,string>>({en:'',ru:'',es:''});
  const [original,setOriginal]=useState('en');const [selected,setSelected]=useState<string[]>(['en']);const [newLanguage,setNewLanguage]=useState('');
  const [wordTip,setWordTip]=useState<{rect:DOMRect;word:string;language:string;translations:{targetLanguage:string;translation:string}[];error?:boolean;loading?:boolean}|null>(null);const wordRequest=useRef(0);
  const [targetLanguage,setTargetLanguage]=useState('ru');const [translationDraft,setTranslationDraft]=useState('');const [wordBusy,setWordBusy]=useState(false);const [wordError,setWordError]=useState('');
  const [addAnchor,setAddAnchor]=useState<HTMLElement|null>(null);
  const [error,setError]=useState('');const [saved,setSaved]=useState(false);const [loading,setLoading]=useState(false);const [loaded,setLoaded]=useState(false);const [editing,setEditing]=useState(false);
  const [metadataHeight,setMetadataHeight]=useState<number|undefined>(readMetadataHeight);const bodyRef=useRef<HTMLDivElement>(null);const metadataRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{wordRequest.current++;setWordTip(null);if(!track){setAddAnchor(null);return;}const controller=new AbortController();setTexts({en:'',ru:'',es:''});setOriginal('en');setSelected(['en']);setNewLanguage('');setError('');setSaved(false);setLoaded(false);setLoading(true);setEditing(false);
    void fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Unable to load song text');return r.json();}).then(data=>{const all={en:'',ru:'',es:'',...data.texts};setTexts(all);setOriginal(data.originalLanguage);setSelected([Object.hasOwn(all,data.originalLanguage)?data.originalLanguage:'en']);setEditing(!Object.values(all).some(value=>Boolean(value)));setLoaded(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[track?.id]);
  async function save(){if(!track)return;setLoading(true);setError('');setSaved(false);try{const r=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/text`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts})});if(!r.ok)throw new Error('Unable to save song text');setSaved(true);setEditing(false);}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setLoading(false);}}
  async function changeOriginal(language:string){if(!track)return;setError('');try{const r=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/language`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({language})});if(!r.ok)throw new Error('Unable to save original language');setOriginal(language);}catch(e){setError(e instanceof Error?e.message:'Unable to save original language');}}
  function addLanguage(){const code=newLanguage.trim().toLowerCase();if(!/^[a-z]{2,3}$/.test(code)){setError('Enter a two- or three-letter language code.');return;}if(!Object.hasOwn(texts,code)&&Object.keys(texts).length>=12){setError('You can add up to 12 languages.');return;}setTexts(prev=>({...prev,[code]:prev[code]??''}));setSelected(prev=>prev.includes(code)?prev:[...prev,code]);setNewLanguage('');setError('');setSaved(false);setAddAnchor(null);}
  async function showWordTranslation(event:React.MouseEvent<HTMLElement>|React.TouchEvent<HTMLElement>,language:string){
    const selection=window.getSelection();const word=selection?.toString().trim()??'';const request=++wordRequest.current;
    if(!track||!selection||selection.rangeCount===0||!event.currentTarget.contains(selection.anchorNode)||!event.currentTarget.contains(selection.focusNode)||!/[\p{L}\p{N}]/u.test(word)||word.length>200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(word)){setWordTip(null);return;}
    const rect=selection.getRangeAt(0).getBoundingClientRect();setTargetLanguage(language==='ru'?'en':'ru');setTranslationDraft('');setWordError('');setWordBusy(false);setWordTip({rect,word,language,translations:[],loading:true});
    try {const query=new URLSearchParams({word,sourceLanguage:language});const response=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/words?${query}`);if(!response.ok)throw new Error();const data=await response.json();if(request===wordRequest.current)setWordTip({rect,word,language,translations:data.translations});} catch {if(request===wordRequest.current)setWordTip({rect,word,language,translations:[],error:true});}
  }
  async function translateSelection(useAi:boolean){
    if(!track||!wordTip||wordBusy)return;const tip=wordTip,request=wordRequest.current;setWordBusy(true);setWordError('');
    try {
      if(useAi){
        const message=`Translate the following exact selected text for this song and save it with the save_word_translations tool. Read the song lyrics for context. Track ID: ${JSON.stringify(track.id)}; source language: ${tip.language}; target language: ${targetLanguage}; exact selected text (JSON string): ${JSON.stringify(tip.word)}. Save the complete selected text as one entry; do not substitute individual words.`;
        const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),message})});
        if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'AI translation failed');}
      }else{
        const response=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/words`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({word:tip.word,sourceLanguage:tip.language,targetLanguage,translation:translationDraft})});if(!response.ok)throw new Error('Unable to save translation');
      }
      const query=new URLSearchParams({word:tip.word,sourceLanguage:tip.language});const response=await fetch(`/api/tracks/${encodeURIComponent(track.id)}/words?${query}`);if(!response.ok)throw new Error('Unable to reload translation');const data=await response.json();
      if(!data.translations.some((item:{targetLanguage:string})=>item.targetLanguage===targetLanguage))throw new Error('The agent did not save a translation. Please try again.');
      if(request===wordRequest.current){setWordTip({...tip,loading:false,error:false,translations:data.translations});setTranslationDraft('');}
    }catch(error){if(request===wordRequest.current)setWordError(error instanceof Error?error.message:'Unable to translate');}finally{if(request===wordRequest.current)setWordBusy(false);}
  }
  function clearWordTip(){wordRequest.current++;setWordTip(null);}
  function toggleLanguage(code:string){setSelected(prev=>prev.includes(code)?prev.length===1?prev:prev.filter(item=>item!==code):[...prev,code]);}
  function updateMetadataHeight(value:number){const max=Math.max(80,(bodyRef.current?.clientHeight??value+180)-180);const height=Math.round(Math.max(80,Math.min(max,value)));setMetadataHeight(height);try{localStorage.setItem('music-shelf-song-metadata-height',String(height));}catch{/* Storage may be unavailable. */}}
  function resizeMetadata(event:React.PointerEvent<HTMLDivElement>){if(event.button!==0||!metadataRef.current||!bodyRef.current)return;event.preventDefault();const startY=event.clientY;const startHeight=metadataRef.current.getBoundingClientRect().height;const element=event.currentTarget;element.setPointerCapture(event.pointerId);const move=(e:PointerEvent)=>{updateMetadataHeight(startHeight+e.clientY-startY);};const end=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);};element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);}
  const tabLanguages=[...preferredLanguages.filter(code=>Object.hasOwn(texts,code)),...Object.keys(texts).filter(code=>!preferredLanguages.includes(code))];
  const otherLanguages=Array.from(new Set([original,...Object.keys(texts),...languageCodes])).filter(code=>code!=='und'&&!preferredLanguages.includes(code)).sort((a,b)=>languageLabel(a).localeCompare(languageLabel(b)));
  const title=<Box sx={{display:'flex',alignItems:'center',gap:1,flexWrap:'wrap'}}><span>{track?.title}</span>{track&&<Status value={track.status} />}</Box>;
  const info=(label:string,value:string)=><Box key={label}><Typography component="dt" color="text.secondary" sx={{fontSize:12,opacity:.7}}>{label}</Typography><Typography component="dd" sx={{fontSize:14,m:0,overflowWrap:'anywhere',fontFamily:label==='SHA-256'?'monospace':'inherit'}}>{value}</Typography></Box>;
  const languageField=<Box><Typography component="dt" color="text.secondary" sx={{fontSize:12,opacity:.7}}>Original language</Typography><Box component="dd" sx={{m:0}}><FormControl size="small"><Select aria-label="Original language" value={original} renderValue={value=>value} disabled={!loaded} onChange={e=>void changeOriginal(e.target.value)} sx={{fontSize:12,height:24,minWidth:56,'& .MuiSelect-select':{py:0,pl:1,pr:'24px !important'},'& .MuiSelect-icon':{fontSize:18}}}>{[...preferredLanguages,...otherLanguages].map((code,index)=><MenuItem key={code} value={code} divider={index===preferredLanguages.length-1}>{languageLabel(code)}</MenuItem>)}</Select></FormControl></Box></Box>;
  return <WindowFrame open={Boolean(track)} onClose={onClose} id="song" defaultPlacement="modal" title={title} allowExternalFocus={Boolean(wordTip)}>
    <Box className="song-details-body" ref={bodyRef}>
      <Box className="song-metadata" ref={metadataRef} sx={metadataHeight===undefined?undefined:{height:metadataHeight,maxHeight:'calc(100% - 180px)'}}>
        <Box className="track-metadata-row" sx={{display:'flex',alignItems:'center',gap:1}}><GroupsOutlined sx={{fontSize:17,color:'text.secondary',flexShrink:0}} /><Box sx={{minWidth:0,fontSize:16,lineHeight:1.5}}>{track&&<EntityLink kind="artist" name={track.artist} preview />}</Box></Box>
        <Box className="track-metadata-row" sx={{display:'flex',alignItems:'center',gap:1}}><AlbumOutlined sx={{fontSize:17,color:'text.secondary',flexShrink:0}} /><Box sx={{minWidth:0,fontSize:16,lineHeight:1.5,color:'text.secondary'}}>{track?.album?<EntityLink kind="album" name={track.album} preview />:<Typography sx={{fontSize:'inherit'}}>Album unknown</Typography>}</Box></Box>
        <Box component="dl" className="file-details">{file&&<>{info('File',file.name)}{info('Format / codec',`${file.format.toUpperCase()} / ${file.codec}`)}{info('Quality',`${file.bitDepth||'—'} bits · ${file.sampleRate.toLocaleString('en-GB')} Hz · ${file.channels} channels`)}{info('Size',`${formatSize(file.sizeBytes)} · ${file.sizeBytes.toLocaleString('en-GB')} bytes`)}{info('Duration',`${Math.floor(file.durationSeconds/60)}:${String(Math.floor(file.durationSeconds%60)).padStart(2,'0')}`)}</>}{languageField}{file&&<>{info('Bitrate',`${Math.round(file.bitrateBps/1000)} kbps`)}{info('SHA-256',file.sha256)}</>}</Box>
      </Box>
      <Box className="song-divider" role="separator" aria-label="Resize song information and lyrics" aria-orientation="horizontal" tabIndex={0} onPointerDown={resizeMetadata} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();updateMetadataHeight((metadataRef.current?.getBoundingClientRect().height??80)+(e.key==='ArrowDown'?20:-20));}}}/>
      <Box className="lyrics-section">
        <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><Typography variant="subtitle1">Lyrics and translations</Typography><Button size="small" disabled={!loaded||loading} onClick={()=>setEditing(value=>!value)}>{editing?'Preview':'Edit'}</Button></Box>
        <Box className="lyrics-toolbar"><Box role="tablist" aria-label="Lyrics languages" aria-multiselectable="true" className="lyrics-tabs">{tabLanguages.map(code=><ButtonBase key={code} role="tab" aria-selected={selected.includes(code)} className={`lyrics-tab${selected.includes(code)?' selected':''}`} onClick={()=>{clearWordTip();toggleLanguage(code);}}>{selected.includes(code)?<CheckBoxRounded aria-hidden="true" />:<CheckBoxOutlineBlankRounded aria-hidden="true" />}{code}</ButtonBase>)}</Box>
          <Tooltip title="Add language"><span><IconButton aria-label="Add language" disabled={!loaded||loading} onClick={e=>setAddAnchor(e.currentTarget)}><AddRounded /></IconButton></span></Tooltip>
        </Box>
        <Popover open={Boolean(addAnchor)} anchorEl={addAnchor} onClose={()=>setAddAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}><Box sx={{p:2,display:'flex',gap:1,alignItems:'center'}}><TextField autoFocus size="small" label="Language code" placeholder="fr" value={newLanguage} onChange={e=>setNewLanguage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addLanguage();}}} slotProps={{htmlInput:{maxLength:3}}}/><Button onClick={addLanguage} disabled={!newLanguage.trim()}>Add</Button></Box></Popover>
        <Box className="lyrics-scroll" data-testid="lyrics-scroll" onScroll={clearWordTip} onMouseDown={clearWordTip}><Box className="lyrics-columns" sx={{minWidth:selected.length*240}}>{tabLanguages.filter(code=>selected.includes(code)).map(code=><Box className="lyrics-column" key={code}><Box className="lyrics-column-body">{editing?<><Box aria-hidden="true" className="lyrics-mirror">{texts[code]||' '}{'\n'}</Box><textarea aria-label={`Lyrics ${code}`} className="lyrics-editor" placeholder={code==='und'?'Unknown language':code} value={texts[code]??''} disabled={loading||!loaded} onChange={e=>{setTexts(prev=>({...prev,[code]:e.target.value}));setSaved(false);}} /></>:<Box className="lyrics-markdown" onMouseUp={e=>void showWordTranslation(e,code)} onTouchEnd={e=>void showWordTranslation(e,code)}><ReactMarkdown remarkPlugins={[remarkGfm]}>{texts[code]||''}</ReactMarkdown></Box>}</Box></Box>)}</Box></Box>
        <Popper open={Boolean(wordTip)} role="dialog" aria-label="Word or phrase translation" anchorEl={wordTip?{getBoundingClientRect:()=>wordTip.rect}:null} placement="top" modifiers={[{name:'offset',options:{offset:[0,10]}}]} sx={{zIndex:1500}}><Paper className="word-translation-tip" elevation={4}>
          <Box sx={{fontWeight:600,overflowWrap:'anywhere',mb:.5}}>{wordTip?.word}</Box>
          {wordTip?.loading?'Loading…':wordTip?.error?'Translation unavailable':wordTip?.translations.length?wordTip.translations.map(item=><div key={item.targetLanguage}><b>{item.targetLanguage}</b> {item.translation}</div>):'No saved translation'}
          <Box sx={{display:'flex',gap:1,alignItems:'center',mt:1}}><TextField select label="Translate to" size="small" value={targetLanguage} onChange={e=>setTargetLanguage(e.target.value)} sx={{minWidth:88}}>{Array.from(new Set([...preferredLanguages,...Object.keys(texts),...languageCodes])).filter(code=>code!=='und'&&code!==wordTip?.language).map(code=><MenuItem key={code} value={code}>{languageLabel(code)}</MenuItem>)}</TextField><TextField label="Translation" size="small" value={translationDraft} onChange={e=>setTranslationDraft(e.target.value)} slotProps={{htmlInput:{maxLength:500}}} /></Box>
          <Box sx={{display:'flex',gap:.5,mt:.5}}><Button size="small" disabled={wordBusy||!translationDraft.trim()} onClick={()=>void translateSelection(false)}>Save</Button><Button size="small" disabled={wordBusy} onClick={()=>void translateSelection(true)}>{wordBusy?'Working…':'Translate with AI'}</Button><Button size="small" onClick={clearWordTip}>Close</Button></Box>
          {wordError&&<Typography color="error" variant="caption">{wordError}</Typography>}
        </Paper></Popper>
        <Box className="lyrics-footer"><Button variant="contained" disabled={loading||!loaded} onClick={()=>void save()}>Save lyrics</Button>{saved&&<Typography color="success.main" variant="caption">Saved</Typography>}{error&&<Alert severity="error">{error}</Alert>}</Box>
      </Box>
    </Box>
  </WindowFrame>;
}
