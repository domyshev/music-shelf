import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, IconButton, InputAdornment, Menu, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { readApiResponse, waitForChatTurn } from '../chatRequest';
import { WindowFrame } from './WindowFrame';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
type Turn = {id:number;requestId:string;message:string;reply:string|null;state:'pending'|'complete'|'failed';createdAt:string};
type Model = {id:string;name:string;supportsTools?:boolean;pricing?:{prompt?:string;completion?:string}};
async function api(path:string, init?:RequestInit):Promise<any> { const response=await fetch(path,{credentials:'same-origin',...init});return readApiResponse(response); }
export function AiDrawer({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [settingsOpen,setSettingsOpen]=useState(false),[model,setModel]=useState(''),[token,setToken]=useState(''),[hasToken,setHasToken]=useState(false),[models,setModels]=useState<Model[]>([]),[turns,setTurns]=useState<Turn[]>([]),[nextBefore,setNextBefore]=useState<number|null>(null),[loadingHistory,setLoadingHistory]=useState(false),[pendingText,setPendingText]=useState(''),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[loadingModels,setLoadingModels]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[menuAnchor,setMenuAnchor]=useState<HTMLElement|null>(null);
  const historyBox=useRef<HTMLDivElement>(null);const scrollToLatest=useRef(false);
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
  useEffect(()=>{if(!open||!turns.some(turn=>turn.state==='pending'))return;const timer=setInterval(()=>{void loadHistory().catch(()=>{});},3000);return()=>clearInterval(timer);},[open,turns]);
  async function save(removeToken=false){setBusy(true);setError('');setNotice('');try{const d=await api('/api/ai/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,...(token&&!removeToken?{token}:{}),...(removeToken?{removeToken:true}:{})})});setHasToken(d.hasToken);setToken('');setNotice('Settings saved');}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}
  async function send(e:FormEvent){
    e.preventDefault();const text=input.trim();if(!text||busy||loadingHistory||turns.some(turn=>turn.state==='pending'))return;
    const requestId=crypto.randomUUID();scrollToLatest.current=true;setInput('');setPendingText(text);setBusy(true);setError('');
    try {
      await api('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,message:text})});
      await waitForChatTurn(requestId);
      await loadHistory();
    } catch(e) {
      try {await loadHistory();} catch { /* The request may still be running; never resubmit it automatically. */ }
      setError(e instanceof Error?e.message:'Unable to send message');
    } finally {setPendingText('');setBusy(false);}
  }
  const title=<Box sx={{display:'flex',alignItems:'center',gap:1}}>{settingsOpen&&<IconButton aria-label="Back to chat" onClick={()=>{setSettingsOpen(false);setError('');setNotice('');}}><ArrowBackRounded /></IconButton>}{settingsOpen?'Agent settings':'AI assistant'}</Box>;
  const actions=!settingsOpen?<><Tooltip title="Agent menu"><IconButton aria-label="Agent menu" onClick={e=>setMenuAnchor(e.currentTarget)}><MoreVertRounded /></IconButton></Tooltip><Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={()=>setMenuAnchor(null)}><MenuItem onClick={()=>{setMenuAnchor(null);setSettingsOpen(true);setError('');}}><SettingsOutlined sx={{fontSize:18,mr:1}} />Agent settings</MenuItem></Menu></>:null;
  return <WindowFrame open={open} onClose={onClose} id="agent" defaultPlacement="right" title={title} actions={actions}>
    {settingsOpen?<Stack spacing={2} sx={{p:2,overflowY:'auto'}}><Typography color="text.secondary" variant="body2">Your settings are saved for your account and available when you sign in from another browser.</Typography><TextField className="token-field" label={hasToken?'Replace API token':'OpenRouter API token'} type="password" autoComplete="new-password" value={token} placeholder={hasToken?'●●●●●●●●●●●●':''} onChange={e=>setToken(e.target.value)} helperText={hasToken?'A token is saved. Leave blank to keep it.':'Your token is stored encrypted on the server.'} slotProps={{inputLabel:{shrink:hasToken||undefined},input:{endAdornment:hasToken?<InputAdornment position="end"><Tooltip title="Remove token"><span><IconButton aria-label="Remove token" disabled={busy} onClick={()=>void save(true)}><DeleteOutlineRounded /></IconButton></span></Tooltip></InputAdornment>:undefined}}} fullWidth /><Autocomplete options={models.filter(x=>x.supportsTools || x.id===model)} loading={loadingModels} value={models.find(x=>x.id===model)??null} onChange={(_e,v)=>setModel(v?.id??'')} getOptionLabel={o=>`${o.name} (${o.id})`} isOptionEqualToValue={(a,b)=>a.id===b.id} renderInput={params=><TextField {...params} label="OpenRouter model" helperText={model && models.find(x=>x.id===model)?.supportsTools===false ? 'This model does not support the tools needed for library and downloads. Choose another model.' : 'Only tool-capable models are listed. OpenRouter requests may incur charges.'} />} /><Stack direction="row" spacing={1}><Button variant="contained" disabled={busy} onClick={()=>void save()}>Save</Button></Stack>{notice&&<Alert severity="success">{notice}</Alert>}{error&&<Alert severity="error">{error}</Alert>}</Stack>:<><Box ref={historyBox} sx={{flex:1,overflowY:'auto',p:2}}>{nextBefore&&<Button size="small" disabled={loadingHistory} onClick={()=>void loadHistory(nextBefore).catch(e=>setError(e.message))}>Load earlier messages</Button>}{!turns.length&&!pendingText&&!loadingHistory&&<Typography variant="body2" color="text.secondary">Я хранитель твоей музыки. Чего надобно старец</Typography>}{turns.map(turn=><Box key={turn.id}>{([{role:'user',content:turn.message},...(turn.reply?[{role:'assistant',content:turn.reply}]:[])]).map((m,i)=><Box key={i} sx={{my:1.5,p:1.5,borderRadius:2,bgcolor:m.role==='user'?'action.selected':'background.default',overflowWrap:'anywhere'}}>{m.role==='user'?<Typography variant="caption" color="text.secondary">You</Typography>:<Box component="img" src="/music-shelf.svg" alt="Music Shelf assistant" className="ai-message-icon" />} {m.role==='assistant'?<Box className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{table:({children,...props})=><div className="ai-table-scroll"><table {...props}>{children}</table></div>,a:({children,...props})=><a {...props} target="_blank" rel="noopener noreferrer">{children}</a>}}>{m.content}</ReactMarkdown></Box>:<Typography variant="body2" component="div" sx={{whiteSpace:'pre-wrap'}}>{m.content}</Typography>}</Box>)}{turn.state==='failed'&&<Typography variant="caption" color="error">Response incomplete. Check the queue before retrying a download request.</Typography>}{turn.state==='pending'&&<Typography variant="caption" color="text.secondary">Processing…</Typography>}</Box>)}{pendingText&&!turns.some(turn=>turn.message===pendingText&&turn.state==='pending')&&<Box sx={{my:1.5,p:1.5,borderRadius:2,bgcolor:'action.selected',whiteSpace:'pre-wrap'}}>{pendingText}</Box>}{busy&&<CircularProgress size={20} />}</Box><Box component="form" onSubmit={send} sx={{p:2,borderTop:1,borderColor:'divider'}}>{error&&<Alert severity="error" sx={{mb:1}}>{error}</Alert>}<TextField fullWidth multiline maxRows={5} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy&&!loadingHistory&&input.trim())e.currentTarget.closest('form')?.requestSubmit();}}} placeholder="Ask about music…" slotProps={{htmlInput:{"aria-label":"Message AI"}}} /><Button type="submit" variant="contained" disabled={busy||loadingHistory||turns.some(turn=>turn.state==='pending')||!input.trim()} sx={{mt:1}}>Send</Button></Box></>}
  </WindowFrame>;
}
