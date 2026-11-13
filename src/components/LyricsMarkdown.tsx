import { Children, cloneElement, createContext, isValidElement, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Root, RootContent, Text } from 'hast';

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

const underlineColors=['#7650a6','#376c9e','#b04e73','#5861ad','#9a579f','#396f88','#ad4f58','#5e67a2'];
type Match={start:number;end:number;level:number;color:string};
function findTranslations(text:string,phrases:string[]):Match[] {
  const found:{start:number;end:number;level:number;color:string}[]=[];
  for(const [index,phrase] of [...new Set(phrases)].sort().entries()) {
    const pattern=phrase.trim().split(/\s+/u).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');if(!pattern)continue;
    const re=new RegExp(pattern,'giu');for(const match of text.matchAll(re)){
      const start=match.index,end=start+match[0].length;const before=text[start-1],after=text[end];
      if(before&&/[\p{L}\p{N}]/u.test(before)&&/[\p{L}\p{N}]/u.test(match[0][0]))continue;
      if(after&&/[\p{L}\p{N}]/u.test(after)&&/[\p{L}\p{N}]/u.test(match[0].at(-1)!))continue;
      found.push({start,end,level:0,color:underlineColors[index%underlineColors.length]});
    }
  }
  found.sort((a,b)=>a.start-b.start||b.end-a.end);
  for(const [index,item] of found.entries()){const overlapping=found.slice(0,index).filter(other=>other.end>item.start);const used=new Set(overlapping.map(other=>other.level));while(used.has(item.level))item.level++;const colors=new Set(overlapping.map(other=>other.color));if(colors.has(item.color))item.color=underlineColors.find(color=>!colors.has(color))??`hsl(${(item.level*137.5)%360} 35% 62%)`;}
  return found;
}
function translatedText(text:string,found:Match[],offset:number):RootContent[] {
  const relevant=found.filter(item=>item.end>offset&&item.start<offset+text.length);
  if(!relevant.length)return [{type:'text',value:text} as Text];
  const edges=[...new Set([0,text.length,...relevant.flatMap(item=>[Math.max(0,item.start-offset),Math.min(text.length,item.end-offset)])])].sort((a,b)=>a-b);const result:RootContent[]=[];
  for(let i=0;i<edges.length-1;i++){const start=edges[i],end=edges[i+1],value=text.slice(start,end),active=relevant.filter(item=>item.start<=start+offset&&item.end>=end+offset);if(!active.length){result.push({type:'text',value} as Text);continue;}
    const images=active.map(item=>`repeating-linear-gradient(to right,${item.color} 0 2px,transparent 2px 4px)`).join(',');
    const positions=active.map(item=>`left ${item.level*3}px`).join(',');
    result.push({type:'element',tagName:'span',properties:{className:['translated-phrase'],style:`--translation-lines:${images};--translation-line-size:${active.map(()=>'100% 1px').join(',')};--translation-line-position:${positions};--translation-line-height:${Math.max(...active.map(item=>item.level))*3+1}px`},children:[{type:'text',value}]} as Element);
  }
  return result;
}
function markTranslations(phrases:string[]) {return (root:Root)=>{
  function markParagraph(node:Element){
    let text='';function collect(parent:Element){for(const child of parent.children){if(child.type==='text')text+=child.value;else if(child.type==='element')collect(child);}}collect(node);
    const found=findTranslations(text,phrases);let offset=0;
    function replace(parent:Element){parent.children=parent.children.flatMap(child=>{if(child.type==='text'){const start=offset;offset+=child.value.length;return translatedText(child.value,found,start);}if(child.type==='element')replace(child);return [child];}) as typeof parent.children;}replace(node);
  }
  function visit(node:Root|Element){for(const child of node.children)if(child.type==='element'){if(child.tagName==='p')markParagraph(child);else visit(child);}}visit(root);
};}

export function LyricsMarkdown({text,phrases=[]}:{text:string;phrases?:string[]}) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[()=>markTranslations(phrases)]} components={{blockquote:({children})=><blockquote><InLyricsBlock.Provider value>{children}</InLyricsBlock.Provider></blockquote>,p:({children})=><LyricsParagraph>{children}</LyricsParagraph>}}>{text}</ReactMarkdown>;
}
