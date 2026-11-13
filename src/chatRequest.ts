export type ChatRequestResult = {state:'pending'|'complete'|'failed';reply:string|null};

export async function readApiResponse(response:Response) {
  const type=response.headers.get('content-type')??'';
  if(!type.toLowerCase().includes('application/json'))throw new Error(`Unexpected server response (HTTP ${response.status}). Check chat history and the download queue before retrying.`);
  let data:unknown;
  try{data=await response.json();}catch{throw new Error(`Invalid server response (HTTP ${response.status}). Check chat history and the download queue before retrying.`);}
  if(!response.ok){const error=typeof data==='object'&&data&&'error' in data?(data as {error?:unknown}).error:undefined;throw new Error(typeof error==='string'?error:'Request failed');}
  return data;
}

export async function waitForChatTurn(requestId:string):Promise<ChatRequestResult> {
  const deadline=Date.now()+10*60*1000;
  while(Date.now()<deadline){
    const response=await fetch(`/api/ai/chat/turn/${encodeURIComponent(requestId)}`,{credentials:'same-origin',cache:'no-store'});
    const result=await readApiResponse(response) as ChatRequestResult;
    if(result.state==='complete')return result;
    if(result.state==='failed')throw new Error('The response could not be completed. Check the download queue before retrying.');
    if(result.state!=='pending')throw new Error('Unknown response status. Check chat history before retrying.');
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('The response is still being processed. Check chat history and the download queue before retrying.');
}

export async function waitForTranslation(requestId:string):Promise<void> {
  const deadline=Date.now()+10*60*1000;
  while(Date.now()<deadline){
    const response=await fetch(`/api/ai/translations/${encodeURIComponent(requestId)}`,{credentials:'same-origin',cache:'no-store'});
    const result=await readApiResponse(response) as {state:string};
    if(result.state==='complete')return;
    if(result.state!=='pending')throw new Error('Translation could not be completed.');
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Translation is still being processed.');
}
