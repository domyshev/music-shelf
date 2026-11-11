import type { ColumnFiltersState } from '@tanstack/react-table';
import type { CatalogQuery } from '../shared/catalog';
import { historyRequestFilters, isCalendarDate } from './historyFilters';

const lists=['status','artist','year','tags'];
const numbers=['sampleRate','bitDepth','sizeBytes','attempts'];
const dates=['queuedAt','completedAt'];

export function validCatalogFilters(raw:unknown):ColumnFiltersState {
  if(!Array.isArray(raw))return [];
  return raw.filter(item=>{
    if(!item || typeof item!=='object' || typeof item.id!=='string')return false;
    if(lists.includes(item.id))return Array.isArray(item.value)&&item.value.length<=1000&&item.value.every((value:unknown)=>typeof value==='string'&&value.length<=1000);
    if(item.id==='title')return typeof item.value==='string'&&item.value.length<=1000;
    if(numbers.includes(item.id))return item.value&&typeof item.value==='object'&&['min','max'].every(key=>item.value[key]===undefined||(typeof item.value[key]==='string'&&item.value[key].length<=20&&(!item.value[key]||Number.isFinite(Number(item.value[key]))&&Number(item.value[key])>=0)));
    if(dates.includes(item.id))return item.value&&typeof item.value==='object'&&['start','end'].every(key=>!item.value[key]||isCalendarDate(item.value[key]));
    return false;
  });
}

export function catalogRequestFilters(filters:ColumnFiltersState):CatalogQuery['filters'] {
  const result:Record<string,unknown>={};
  for(const {id,value} of validCatalogFilters(filters)){
    if(lists.includes(id)){if((value as string[]).length)result[id]=value;}
    else if(id==='title'){if((value as string).trim())result[id]=(value as string).trim();}
    else if(numbers.includes(id)){
      const input=value as {min?:string;max?:string};const range:Record<string,number>={};
      if(input.min)range.min=Number(input.min);if(input.max)range.max=Number(input.max);
      if(Object.keys(range).length)result[id]=range;
    } else if(dates.includes(id)){
      const range=value as {start?:string;end?:string};
      const dates=historyRequestFilters({kinds:[],start:range.start??'',end:range.end??''});
      if(dates.from||dates.to)result[id]={...(dates.from?{from:dates.from}:{}),...(dates.to?{to:dates.to}:{})};
    }
  }
  return result as CatalogQuery['filters'];
}
