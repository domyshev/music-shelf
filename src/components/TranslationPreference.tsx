import { useEffect, useState } from 'react';
import { Alert, MenuItem, TextField, Typography } from '@mui/material';
const names=new Intl.DisplayNames(['en'],{type:'language'});
const codes=Array.from({length:676},(_,i)=>String.fromCharCode(97+Math.floor(i/26),97+i%26)).filter(code=>names.of(code)!==code);
const ordered=['ru','en','es',...codes.filter(code=>!['ru','en','es'].includes(code)).sort((a,b)=>(names.of(a)??a).localeCompare(names.of(b)??b))];
export function TranslationPreference({open}:{open:boolean}) {
 const [language,setLanguage]=useState('ru'),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;const controller=new AbortController();setBusy(true);setError('');void fetch('/api/preferences',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Unable to load translation language');return r.json();}).then(data=>setLanguage(data.translationLanguage)).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[open]);
 async function change(value:string){setBusy(true);setError('');try{const response=await fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({translationLanguage:value})});if(!response.ok)throw new Error('Unable to save translation language');setLanguage(value);}catch(e){setError(e instanceof Error?e.message:'Unable to save translation language');}finally{setBusy(false);}}
 return <><Typography variant="subtitle1" sx={{fontWeight:600,mt:2,mb:1}}>Translation</Typography><TextField select fullWidth label="Default translation language" value={language} disabled={busy} onChange={event=>void change(event.target.value)}>{ordered.map(code=><MenuItem key={code} value={code}>{names.of(code)}</MenuItem>)}</TextField>{error&&<Alert severity="error" sx={{mt:1}}>{error}</Alert>}</>;
}
