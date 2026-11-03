import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, IconButton, Modal, Tooltip, Typography } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FirstPageRounded from '@mui/icons-material/FirstPageRounded';
import LastPageRounded from '@mui/icons-material/LastPageRounded';
import CropSquareRounded from '@mui/icons-material/CropSquareRounded';

type Placement='left'|'right'|'modal';
const read=(key:string,fallback:string)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const write=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{/* Storage may be unavailable. */}};
const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),Math.max(min,max));

export function WindowFrame({open,onClose,id,defaultPlacement,title,actions,children}:{open:boolean;onClose:()=>void;id:'song'|'agent';defaultPlacement:Placement;title:ReactNode;actions?:ReactNode;children:ReactNode}) {
  const key=`music-shelf-${id}-window`;
  const [placement,setPlacement]=useState<Placement>(()=>{const p=read(`${key}-placement`,defaultPlacement);return p==='left'||p==='right'||p==='modal'?p:defaultPlacement;});
  const [width,setWidth]=useState(()=>{const legacy=id==='agent'?read('music-shelf-ai-drawer-width','430'):'620';const w=Number(read(`${key}-width`,legacy));return Number.isFinite(w)&&w>=280&&w<=1400?w:(id==='agent'?430:620);});
  const [height,setHeight]=useState(()=>{const h=Number(read(`${key}-height`,'700'));return Number.isFinite(h)&&h>=250&&h<=1400?h:700;});
  const [viewport,setViewport]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
  const drag=useRef<{kind:'width'|'height'|'both';x:number;y:number;width:number;height:number}|null>(null);
  useEffect(()=>{const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const minWidth=Math.min(340,Math.max(200,viewport.width-24));const maxWidth=Math.max(minWidth,viewport.width-24);const minHeight=Math.min(id==='song'?480:300,Math.max(180,viewport.height-24));const maxHeight=Math.max(minHeight,viewport.height-24);
  const visibleWidth=clamp(width,minWidth,maxWidth),visibleHeight=clamp(height,minHeight,maxHeight);
  function setMode(next:Placement){setPlacement(next);write(`${key}-placement`,next);}
  function setSize(nextWidth:number,nextHeight:number){const w=clamp(Math.round(nextWidth),minWidth,maxWidth),h=clamp(Math.round(nextHeight),minHeight,maxHeight);setWidth(w);setHeight(h);write(`${key}-width`,String(w));write(`${key}-height`,String(h));if(id==='agent')write('music-shelf-ai-drawer-width',String(w));}
  function pointerDown(kind:'width'|'height'|'both',e:React.PointerEvent<HTMLElement>){drag.current={kind,x:e.clientX,y:e.clientY,width:visibleWidth,height:visibleHeight};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}
  function pointerMove(e:React.PointerEvent<HTMLElement>){if(!drag.current)return;const d=drag.current;const dx=e.clientX-d.x,dy=e.clientY-d.y;const multiplier=placement==='right'?-1:placement==='modal'?2:1;setSize(d.width+(d.kind==='height'?0:dx*multiplier),d.height+(d.kind==='width'?0:dy*(placement==='modal'?2:1)));}
  function pointerUp(e:React.PointerEvent<HTMLElement>){drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
  const resizeProps=(kind:'width'|'height'|'both')=>({onPointerDown:(e:React.PointerEvent<HTMLElement>)=>pointerDown(kind,e),onPointerMove:pointerMove,onPointerUp:pointerUp,onPointerCancel:()=>{drag.current=null;}});
  const handleKeys=(e:React.KeyboardEvent<HTMLElement>,kind:'width'|'height')=>{if(kind==='width'&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();setSize(visibleWidth+(e.key==='ArrowLeft'?(placement==='right'?24:-24):(placement==='right'?-24:24)),visibleHeight);}if(kind==='height'&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();setSize(visibleWidth,visibleHeight+(e.key==='ArrowUp'?-24:24));}};
  return <Modal open={open} onClose={(_event,reason)=>{if(reason==='escapeKeyDown'&&document.querySelector('[role="tooltip"]'))return;onClose();}} keepMounted={false}>
    <Box role="dialog" aria-modal="true" aria-label={id==='song'?'Song details':'AI assistant'} className={`window-frame window-${placement}`} sx={{width:{xs:'100%',sm:visibleWidth},height:placement==='modal'?{xs:'100%',sm:visibleHeight}:'100%',maxWidth:'100%',maxHeight:'100%'}}>
      <Box className="window-header"><Typography component="div" variant="h6" sx={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{title}</Typography>{actions}
        <Tooltip title="Dock left"><IconButton aria-label="Dock left" aria-pressed={placement==='left'} onClick={()=>setMode('left')}><FirstPageRounded /></IconButton></Tooltip>
        <Tooltip title="Open as dialog"><IconButton aria-label="Open as dialog" aria-pressed={placement==='modal'} onClick={()=>setMode('modal')}><CropSquareRounded /></IconButton></Tooltip>
        <Tooltip title="Dock right"><IconButton aria-label="Dock right" aria-pressed={placement==='right'} onClick={()=>setMode('right')}><LastPageRounded /></IconButton></Tooltip>
        <IconButton aria-label={id==='song'?'Close details':'Close AI'} onClick={onClose}><CloseRounded /></IconButton>
      </Box>
      {children}
      <Box role="separator" aria-label={id==='agent'?'Resize assistant panel':'Resize song panel'} aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={visibleWidth} tabIndex={0} className={`window-resize-width window-resize-${placement}`} {...resizeProps('width')} onKeyDown={e=>handleKeys(e,'width')} />
      {placement==='modal'&&<><Box role="separator" aria-label="Resize panel height" aria-orientation="horizontal" aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={visibleHeight} tabIndex={0} className="window-resize-height" {...resizeProps('height')} onKeyDown={e=>handleKeys(e,'height')} /><Box aria-hidden="true" className="window-resize-corner" {...resizeProps('both')} /></>}
    </Box>
  </Modal>;
}
