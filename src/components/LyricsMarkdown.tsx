import { Children, cloneElement, createContext, isValidElement, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const InLyricsBlock = createContext(false);

function splitLines(children:ReactNode):ReactNode[][] {
  const lines:ReactNode[][]=[[]];
  for(const child of Children.toArray(children)) {
    if(typeof child==='string'||typeof child==='number') {
      const pieces=String(child).split('\n');
      pieces.forEach((piece,index)=>{if(index)lines.push([]);if(piece)lines.at(-1)!.push(piece);});
    } else if(isValidElement<{children?:ReactNode}>(child)) {
      if(child.type==='br'){lines.push([]);continue;}
      if(child.props.children===undefined){lines.at(-1)!.push(child);continue;}
      const nested=splitLines(child.props.children);
      nested.forEach((line,index)=>{if(index)lines.push([]);lines.at(-1)!.push(cloneElement(child as ReactElement<{children?:ReactNode}>,{key:`${child.key??'inline'}-${index}`},line));});
    }
  }
  return lines;
}

function LyricsLine({children}:{children:ReactNode}) {
  const [tip,setTip]=useState('');
  return <Tooltip title={tip} arrow placement="top" disableInteractive>
    <span className="lyrics-line" onMouseEnter={event=>{const line=event.currentTarget;setTip(line.scrollWidth>line.clientWidth?line.textContent??'':'');}} onMouseLeave={()=>setTip('')}>{children}</span>
  </Tooltip>;
}

function LyricsParagraph({children}:{children?:ReactNode}) {
  const inBlock=useContext(InLyricsBlock);
  return <p>{inBlock?splitLines(children).map((line,index)=><LyricsLine key={index}>{line.length?line:'\u00a0'}</LyricsLine>):children}</p>;
}

export function LyricsMarkdown({text}:{text:string}) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{blockquote:({children})=><blockquote><InLyricsBlock.Provider value>{children}</InLyricsBlock.Provider></blockquote>,p:({children})=><LyricsParagraph>{children}</LyricsParagraph>}}>{text}</ReactMarkdown>;
}
