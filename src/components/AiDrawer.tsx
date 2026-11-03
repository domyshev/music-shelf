import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, Drawer, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import UnfoldMoreRounded from '@mui/icons-material/UnfoldMoreRounded';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const WIDTH_KEY = 'music-shelf-ai-drawer-width';
const MIN_WIDTH = 340;
const DEFAULT_WIDTH = 430;
const MAX_WIDTH = 1000;
const clampWidth = (value: number, viewport: number) => Math.max(MIN_WIDTH, Math.min(value, MAX_WIDTH, Math.max(MIN_WIDTH, viewport - 80)));
function savedWidth() { try { const value = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH; } catch { return DEFAULT_WIDTH; } }
type Turn = {id:number;requestId:string;message:string;reply:string|null;state:'pending'|'complete'|'failed';createdAt:string};
type Model = {id:string;name:string;supportsTools?:boolean;pricing?:{prompt?:string;completion?:string}};
async function api(path:string, init?:RequestInit) { const response=await fetch(path,{credentials:'same-origin',...init});const data=await response.json();if(!response.ok)throw new Error(data.error??'Request failed');return data; }
export function AiDrawer({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [settingsOpen,setSettingsOpen]=useState(false),[model,setModel]=useState(''),[token,setToken]=useState(''),[hasToken,setHasToken]=useState(false),[models,setModels]=useState<Model[]>([]),[turns,setTurns]=useState<Turn[]>([]),[nextBefore,setNextBefore]=useState<number|null>(null),[loadingHistory,setLoadingHistory]=useState(false),[pendingText,setPendingText]=useState(''),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[loadingModels,setLoadingModels]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const historyBox=useRef<HTMLDivElement>(null);const scrollToLatest=useRef(false);
  const [width,setWidth]=useState(savedWidth); const [viewport,setViewport]=useState(()=>window.innerWidth); const resizing=useRef(false);
  const visibleWidth=clampWidth(width,viewport);
  useEffect(()=>{const resize=()=>setViewport(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  function changeWidth(value:number){const next=clampWidth(value,window.innerWidth);setWidth(next);try{localStorage.setItem(WIDTH_KEY,String(next));}catch{/* Storage can be unavailable in private browsing. */}}

  useEffect(()=>{if(scrollToLatest.current&&historyBox.current){historyBox.current.scrollTop=historyBox.current.scrollHeight;scrollToLatest.current=false;}},[turns,pendingText]);
  async function loadHistory(before?:number) {
    setLoadingHistory(true);
    try {
      const data=await api(`/api/ai/chat/history${before?`?before=${before}`:''}`) as {turns:Turn[];nextBefore:number|null};
      if(!before)scrollToLatest.current=true;
      setTurns(previous=>before?[...data.turns,...previous]:data.turns);setNextBefore(data.nextBefore);
      return data.turns;
    } finally {setLoadingHistory(false);}
  }
  useEffect(()=>{if(open)void loadHistory().catch(e=>setError(e.message));},[open]);
  useEffect(()=>{if(open) void api('/api/ai/settings').then(d=>{setModel(d.model);setHasToken(d.hasToken);}).catch(e=>setError(e.message));},[open]);
  useEffect(()=>{if(open&&settingsOpen&&!models.length){setLoadingModels(true);void api('/api/ai/models').then(d=>setModels(d.models)).catch(e=>setError(e.message)).finally(()=>setLoadingModels(false));}},[open,settingsOpen,models.length]);
  async function save(removeToken=false){setBusy(true);setError('');setNotice('');try{const d=await api('/api/ai/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,...(token&&!removeToken?{token}:{}),...(removeToken?{removeToken:true}:{})})});setHasToken(d.hasToken);setToken('');setNotice('Settings saved');}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}
  async function send(e:FormEvent){
    e.preventDefault();const text=input.trim();if(!text||busy||loadingHistory)return;
    const requestId=crypto.randomUUID();scrollToLatest.current=true;setInput('');setPendingText(text);setBusy(true);setError('');
    try {
      await api('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,message:text})});
      await loadHistory();
    } catch(e) {
      try {const latest=await loadHistory();if(!latest.some(turn=>turn.requestId===requestId))setInput(text);}
      catch {setInput(text);}
      setError(e instanceof Error?e.message:'Unable to send message');
    } finally {setPendingText('');setBusy(false);}
  }
  return <Drawer anchor="right" open={open} onClose={onClose} slotProps={{paper:{sx:{width:{xs:'100%',sm:visibleWidth},maxWidth:'100%',display:'flex'}}}}><Box role="separator" aria-label="Resize assistant panel" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={Math.min(MAX_WIDTH,Math.max(MIN_WIDTH,viewport-80))} aria-valuenow={visibleWidth} tabIndex={0} className="ai-resize-handle" onPointerDown={e=>{resizing.current=true;e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}} onPointerMove={e=>{if(resizing.current)changeWidth(window.innerWidth-e.clientX);}} onPointerUp={e=>{resizing.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{resizing.current=false;}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();changeWidth(visibleWidth+(e.key==='ArrowLeft'?24:-24));}else if(e.key==='Home'){e.preventDefault();changeWidth(MIN_WIDTH);}else if(e.key==='End'){e.preventDefault();changeWidth(MAX_WIDTH);}}}><UnfoldMoreRounded fontSize="small" /></Box><Box sx={{display:'flex',alignItems:'center',p:2,borderBottom:1,borderColor:'divider',gap:1}}>{settingsOpen&&<IconButton aria-label="Back to chat" onClick={()=>{setSettingsOpen(false);setError('');setNotice('');}}><ArrowBackRounded /></IconButton>}<Typography variant="h6" sx={{flex:1}}>{settingsOpen?'AI settings':'AI assistant'}</Typography>{!settingsOpen&&<Tooltip title="AI settings"><IconButton aria-label="AI settings" onClick={()=>{setSettingsOpen(true);setError('');}}><SettingsOutlined /></IconButton></Tooltip>}<IconButton aria-label="Close AI" onClick={onClose}><CloseRounded /></IconButton></Box>
    {settingsOpen?<Stack spacing={2} sx={{p:2,overflowY:'auto'}}><Typography color="text.secondary" variant="body2">Your settings are saved for your account and available when you sign in from another browser.</Typography><TextField label={hasToken?'Replace API token':'OpenRouter API token'} type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} helperText={hasToken?'A token is saved. Leave blank to keep it.':'Your token is stored encrypted on the server.'} fullWidth /><Autocomplete options={models.filter(x=>x.supportsTools || x.id===model)} loading={loadingModels} value={models.find(x=>x.id===model)??null} onChange={(_e,v)=>setModel(v?.id??'')} getOptionLabel={o=>`${o.name} (${o.id})`} isOptionEqualToValue={(a,b)=>a.id===b.id} renderInput={params=><TextField {...params} label="OpenRouter model" helperText={model && models.find(x=>x.id===model)?.supportsTools===false ? 'This model does not support the tools needed for library and downloads. Choose another model.' : 'Only tool-capable models are listed. OpenRouter requests may incur charges.'} />} /><Stack direction="row" spacing={1}><Button variant="contained" disabled={busy} onClick={()=>void save()}>Save</Button>{hasToken&&<Button disabled={busy} onClick={()=>void save(true)}>Remove token</Button>}</Stack>{notice&&<Alert severity="success">{notice}</Alert>}{error&&<Alert severity="error">{error}</Alert>}</Stack>:<><Box ref={historyBox} sx={{flex:1,overflowY:'auto',p:2}}>{nextBefore&&<Button size="small" disabled={loadingHistory} onClick={()=>void loadHistory(nextBefore).catch(e=>setError(e.message))}>Load earlier messages</Button>}{!turns.length&&!pendingText&&!loadingHistory&&<Typography variant="body2" color="text.secondary">Я хранитель твоей музыки. Чего надобно старец</Typography>}{turns.map(turn=><Box key={turn.id}>{([{role:'user',content:turn.message},...(turn.reply?[{role:'assistant',content:turn.reply}]:[])]).map((m,i)=><Box key={i} sx={{my:1.5,p:1.5,borderRadius:2,bgcolor:m.role==='user'?'action.selected':'background.default',overflowWrap:'anywhere'}}>{m.role==='user'?<Typography variant="caption" color="text.secondary">You</Typography>:<Box component="img" src="/music-shelf.svg" alt="Music Shelf assistant" className="ai-message-icon" />} {m.role==='assistant'?<Box className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{table:({children,...props})=><div className="ai-table-scroll"><table {...props}>{children}</table></div>,a:({children,...props})=><a {...props} target="_blank" rel="noopener noreferrer">{children}</a>}}>{m.content}</ReactMarkdown></Box>:<Typography variant="body2" component="div" sx={{whiteSpace:'pre-wrap'}}>{m.content}</Typography>}</Box>)}{turn.state==='failed'&&<Typography variant="caption" color="error">Response incomplete. Check the queue before retrying a download request.</Typography>}{turn.state==='pending'&&<Typography variant="caption" color="text.secondary">Processing…</Typography>}</Box>)}{pendingText&&!turns.some(turn=>turn.message===pendingText&&turn.state==='pending')&&<Box sx={{my:1.5,p:1.5,borderRadius:2,bgcolor:'action.selected',whiteSpace:'pre-wrap'}}>{pendingText}</Box>}{busy&&<CircularProgress size={20} />}</Box><Box component="form" onSubmit={send} sx={{p:2,borderTop:1,borderColor:'divider'}}>{error&&<Alert severity="error" sx={{mb:1}}>{error}</Alert>}<TextField fullWidth multiline maxRows={5} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy&&!loadingHistory&&input.trim())e.currentTarget.closest('form')?.requestSubmit();}}} placeholder="Ask about music…" slotProps={{htmlInput:{"aria-label":"Message AI"}}} /><Button type="submit" variant="contained" disabled={busy||loadingHistory||!input.trim()} sx={{mt:1}}>Send</Button></Box></>}
  </Drawer>;
}
