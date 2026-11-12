import express, { type Request, type Response, type NextFunction } from 'express';
import { verify, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { translationPhrase } from './translation-phrase.js';
import { AuthError, codeLifetime, sessionLifetime, type EmailAuth, type LoginMailer } from './auth.js';
import { snapshotSchema, historyFilterSchema, catalogQuerySchema } from '../shared/catalog.js';
import { CatalogStore, SnapshotConflict } from './store.js';
import type { Features } from './features.js';
import type { Bridge } from './bridge.js';
import { ChatBusy, ChatDuplicate, type ChatHistory } from './chat-history.js';

export interface AppOptions { features?: Features; bridge?: Bridge; chatHistory?: ChatHistory; queueUsers?: string[]; demo?: boolean; store: CatalogStore; auth: EmailAuth; mailer: LoginMailer; origin: string; secureCookies?: boolean; publisherKey?: KeyObject; clientDirectory?: string; now?: () => number }
export function createApp(options: AppOptions) {
  const app = express();
  const now = options.now ?? Date.now;
  const cookieName = options.secureCookies ? '__Host-music-shelf-session' : 'music-shelf-session';
  const cookieOptions = { httpOnly: true, secure: Boolean(options.secureCookies), sameSite: 'lax' as const, path: '/' };
  const token = (request: Request) => { const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? ''; return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''; };
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); next();
  });
  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const authorize = (request: Request, response: Response, next: NextFunction) => {
    const email = options.auth.session(token(request));
    if (!email) { response.status(401).json({ error: 'Sign in required' }); return; }
    response.locals.email = email; next();
  };
  const sameOrigin = (request: Request, response: Response, next: NextFunction) => {
    if (request.get('Origin') !== options.origin) { response.status(403).json({ error: 'Untrusted origin' }); return; }
    next();
  };
  const authError = (error: unknown, response: Response) => {
    if (error instanceof AuthError) {
      if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
      response.status(error.status).json({ error: error.message });
    } else response.status(503).json({ error: 'Unable to sign in right now. Please try again later.' });
  };
  const requestCode = z.object({ email: z.string().trim().max(254).email().transform(value => value.toLowerCase()) }).strict();
  const verifyCode = z.object({ challengeId: z.string().regex(/^[A-Za-z0-9_-]{32}$/), code: z.string().regex(/^\d{6}$/) }).strict();
  app.get('/api/session', authorize, (_request, response) => response.json({ ok: true, email: response.locals.email }));
  app.post('/api/auth/request-code', sameOrigin, express.json({ limit: '8kb' }), async (request, response) => {
    const parsed = requestCode.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Enter a valid email address.' }); return; }
    let challengeId: string | undefined;
    try {
      const challenge = options.auth.issue(parsed.data.email, request.ip ?? 'unknown');
      challengeId = challenge.challengeId;
      await options.mailer.send(parsed.data.email, challenge.code, challenge.challengeId);
      options.auth.delivered(challenge.challengeId);
      response.json({ ok: true, challengeId: challenge.challengeId, expiresIn: codeLifetime, resendAfter: 60 });
    } catch (error) { if (challengeId) options.auth.deliveryFailed(challengeId); authError(error, response); }
  });
  app.post('/api/auth/verify-code', sameOrigin, express.json({ limit: '8kb' }), (request, response) => {
    const parsed = verifyCode.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Enter the six-digit code from your email.' }); return; }
    try {
      const session = options.auth.verify(parsed.data.challengeId, parsed.data.code);
      options.auth.logout(token(request));
      response.cookie(cookieName, session.token, { ...cookieOptions, maxAge: sessionLifetime * 1000 });
      response.json({ ok: true, email: session.email });
    } catch (error) { authError(error, response); }
  });
  app.post('/api/auth/logout', sameOrigin, (request, response) => {
    options.auth.logout(token(request)); response.clearCookie(cookieName, cookieOptions); response.json({ ok: true });
  });
  app.get('/api/tracks/:id/text', authorize, (request, response) => {
    const data = options.features?.lyrics(String(request.params.id),response.locals.email); if (!data) { response.status(404).json({ error: 'Song not found' }); return; } response.json(data);
  });
  app.put('/api/tracks/:id/text', authorize, sameOrigin, express.json({limit:'1mb'}), (request, response) => {
    const code=z.string().regex(/^[a-z]{2,3}$/);
    const parsed=z.object({originalLanguage:code.optional(),texts:z.record(code,z.string().max(50000))}).strict().refine(value=>Object.keys(value.texts).length<=12);
    const data=parsed.safeParse(request.body);
    if (!data.success) { response.status(400).json({error:'Invalid song text'}); return; }
    if (!options.features?.saveLyrics(String(request.params.id),response.locals.email,data.data.originalLanguage ?? options.features.lyrics(String(request.params.id),response.locals.email)?.originalLanguage ?? 'und',data.data.texts)) { response.status(404).json({error:'Song not found'}); return; }
    response.json({ok:true});
  });
  app.get('/api/tracks/:id/words', authorize, (request,response) => {
    const parsed=z.object({word:translationPhrase,sourceLanguage:z.string().regex(/^[a-z]{2,3}$/)}).strict().safeParse(request.query);
    if(!parsed.success){response.status(400).json({error:'Invalid word'});return;}
    const translations=options.features?.wordTranslations(String(request.params.id),response.locals.email,parsed.data.sourceLanguage,parsed.data.word);
    if(!translations){response.status(404).json({error:'Song not found'});return;}
    response.json({translations});
  });
  app.get('/api/tracks/:id/phrases',authorize,(request,response)=>{const phrases=options.features?.translatedPhrases(String(request.params.id),response.locals.email);if(!phrases){response.status(404).json({error:'Song not found'});return;}response.json({phrases});});
  app.put('/api/tracks/:id/words', authorize, sameOrigin, express.json({limit:'4kb'}), (request,response) => {
    const parsed=z.object({word:translationPhrase,sourceLanguage:z.string().regex(/^[a-z]{2,3}$/),targetLanguage:z.string().regex(/^[a-z]{2,3}$/),translation:z.string().trim().min(1).max(500)}).strict().safeParse(request.body);
    if(!parsed.success){response.status(400).json({error:'Invalid translation'});return;}
    const {word,sourceLanguage,targetLanguage,translation}=parsed.data;
    if(!options.features?.saveWordTranslations(String(request.params.id),response.locals.email,sourceLanguage,targetLanguage,[{word,translation}])){response.status(404).json({error:'Song not found'});return;}
    response.json({ok:true});
  });
  app.patch('/api/tracks/:id/words/:variantId', authorize, sameOrigin, express.json({limit:'4kb'}), (request,response) => {
    const variantId=Number(request.params.variantId);const parsed=z.object({translation:z.string().trim().min(1).max(500)}).strict().safeParse(request.body);
    if(!Number.isSafeInteger(variantId)||variantId<1||!parsed.success){response.status(400).json({error:'Invalid translation'});return;}
    if(!options.features?.updateWordTranslation(String(request.params.id),response.locals.email,variantId,parsed.data.translation)){response.status(404).json({error:'Translation not found'});return;}
    response.json({ok:true});
  });
  app.delete('/api/tracks/:id/words/:variantId', authorize, sameOrigin, (request,response) => {
    const variantId=Number(request.params.variantId);if(!Number.isSafeInteger(variantId)||variantId<1){response.status(400).json({error:'Invalid translation'});return;}
    if(!options.features?.deleteWordTranslation(String(request.params.id),response.locals.email,variantId)){response.status(404).json({error:'Translation not found'});return;}
    response.json({ok:true});
  });
  app.put('/api/tracks/:id/language', authorize, sameOrigin, express.json({limit:'1kb'}), (request,response) => {
    const data=z.object({language:z.string().regex(/^(?!und$)[a-z]{2,3}$/)}).strict().safeParse(request.body);
    if (!data.success) { response.status(400).json({error:'Invalid language'}); return; }
    if (!options.features?.setOriginalLanguage(String(request.params.id),data.data.language)) { response.status(404).json({error:'Song not found'}); return; }
    response.json({ok:true});
  });
  app.get('/api/download/settings', authorize, async (_request,response) => {
    if(!options.bridge){response.status(503).json({error:'Download service unavailable'});return;}
    try {const raw=await options.bridge.execute('retry_settings',{},20000);const result=z.object({auto_stop:z.boolean(),max_attempts:z.number().int().min(1).max(1000000)}).safeParse(raw);if(!result.success)throw new Error();response.json({enabled:result.data.auto_stop,maxAttempts:result.data.max_attempts,canEdit:options.queueUsers?.includes(response.locals.email)??false});}catch{response.status(503).json({error:'Unable to load download settings'});}
  });
  app.get('/api/preferences',authorize,(_request,response)=>{if(!options.features){response.status(503).json({error:'Settings unavailable'});return;}response.json({translationLanguage:options.features.translationLanguage(response.locals.email)});});
  app.put('/api/preferences',authorize,sameOrigin,express.json({limit:'1kb'}),(request,response)=>{const parsed=z.object({translationLanguage:z.string().regex(/^(?!und$)[a-z]{2,3}$/)}).strict().safeParse(request.body);if(!parsed.success){response.status(400).json({error:'Invalid language'});return;}if(!options.features){response.status(503).json({error:'Settings unavailable'});return;}options.features.setTranslationLanguage(response.locals.email,parsed.data.translationLanguage);response.json(parsed.data);});
  app.put('/api/download/settings', authorize, sameOrigin, express.json({limit:'2kb'}), async (request,response) => {
    if(!options.queueUsers?.includes(response.locals.email)){response.status(403).json({error:'Only the owner can change download settings'});return;}
    const parsed=z.object({enabled:z.boolean(),maxAttempts:z.number().int().min(1).max(1000000)}).strict().safeParse(request.body);if(!parsed.success){response.status(400).json({error:'Invalid download settings'});return;}
    if(!options.bridge){response.status(503).json({error:'Download service unavailable'});return;}
    try {const raw=await options.bridge.execute('set_retry_settings',{auto_stop:parsed.data.enabled,max_attempts:parsed.data.maxAttempts},20000);const result=z.object({auto_stop:z.boolean(),max_attempts:z.number().int().min(1).max(1000000)}).safeParse(raw);if(!result.success)throw new Error();response.json({enabled:result.data.auto_stop,maxAttempts:result.data.max_attempts,canEdit:true});}catch{response.status(503).json({error:'Unable to save download settings'});}
  });
  app.get('/api/ai/settings', authorize, (_request, response) => response.json(options.features?.settings(response.locals.email) ?? {model:'',hasToken:false}));
  app.get('/api/ai/output-limit', authorize, (_request,response)=>{
    if(!options.features){response.status(503).json({error:'AI unavailable'});return;}
    response.json({maxTokens:options.features.outputLimit(response.locals.email)});
  });
  app.put('/api/ai/output-limit', authorize, sameOrigin, express.json({limit:'1kb'}), (request,response)=>{
    const parsed=z.object({maxTokens:z.union([z.null(),z.literal(4096),z.literal(8192),z.literal(16384),z.literal(32768),z.literal(65536)])}).strict().safeParse(request.body);
    if(!parsed.success){response.status(400).json({error:'Invalid output token limit'});return;}
    if(!options.features){response.status(503).json({error:'AI unavailable'});return;}
    options.features.setOutputLimit(response.locals.email,parsed.data.maxTokens);response.json({maxTokens:parsed.data.maxTokens});
  });
  app.put('/api/ai/settings', authorize, sameOrigin, express.json({limit:'8kb'}), (request,response) => {
    const parsed=z.object({model:z.string().max(200),token:z.string().min(1).max(512).optional(),removeToken:z.boolean().optional()}).strict().safeParse(request.body);
    if (!parsed.success || (parsed.data.token && parsed.data.removeToken)) { response.status(400).json({error:'Invalid settings'}); return; }
    if (!options.features) { response.status(503).json({error:'AI unavailable'}); return; }
    response.json(options.features.saveSettings(response.locals.email,parsed.data.model,parsed.data.token,parsed.data.removeToken));
  });
  app.get('/api/ai/models', authorize, async (_request,response) => {
    try { if (!options.features) throw new Error(); response.json({models:await options.features.models()}); } catch {response.status(502).json({error:'Unable to load models from OpenRouter'});}
  });
  app.get('/api/ai/chat/history', authorize, (request,response) => {
    const before=request.query.before===undefined?undefined:Number(request.query.before);
    if(before!==undefined&&(!Number.isSafeInteger(before)||before<1)) {response.status(400).json({error:'Invalid history cursor'});return;}
    if(!options.chatHistory){response.status(503).json({error:'Chat history unavailable'});return;}
    response.json(options.chatHistory.page(response.locals.email,before));
  });
  app.get('/api/ai/chat/turn/:requestId', authorize, (request,response) => {
    const requestId=String(request.params.requestId);if(!z.uuid().safeParse(requestId).success){response.status(400).json({error:'Invalid request ID'});return;}
    if(!options.chatHistory){response.status(503).json({error:'Chat history unavailable'});return;}
    const turn=options.chatHistory.turn(response.locals.email,requestId);if(!turn){response.status(404).json({error:'Chat turn not found'});return;}response.json(turn);
  });
  app.post('/api/ai/chat', authorize, sameOrigin, express.json({limit:'32kb'}), async (request,response) => {
    const parsed=z.object({requestId:z.uuid(),message:z.string().trim().min(1).max(12000)}).strict().safeParse(request.body);
    if(!parsed.success){response.status(400).json({error:'Invalid chat message'});return;}
    if(!options.features||!options.chatHistory){response.status(503).json({error:'Chat unavailable'});return;}
    const email=response.locals.email;const {requestId,message}=parsed.data;
    const settings=options.features.settings(email);
    if(!settings.hasToken||!settings.model){response.status(400).json({error:'Set an OpenRouter token and model in AI settings.'});return;}
    try {options.chatHistory.begin(email,requestId,message);} catch(error) {
      if(error instanceof ChatBusy){response.status(409).json({error:'Another message is being processed. Please wait.'});return;}
      if(error instanceof ChatDuplicate){response.status(409).json({error:'This message was already submitted. Reload the chat to see its status.'});return;}
      response.status(500).json({error:'Unable to save message'});return;
    }
    const features=options.features,history=options.chatHistory;
    void (async()=>{
      const started=Date.now();let inputTokens=0,outputTokens=0,cost=0,hasUsage=false,completeTokens=true,completeCost=true;
      try {
        const reply=await features.chat(email,history.context(email,requestId),options.store,options.bridge,options.queueUsers?.includes(email) ?? false,usage=>{hasUsage=true;const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;if(valid(usage?.prompt_tokens)&&valid(usage?.completion_tokens)){inputTokens+=usage.prompt_tokens;outputTokens+=usage.completion_tokens;}else completeTokens=false;if(valid(usage?.cost))cost+=usage.cost;else completeCost=false;});
        if(reply===null)throw new Error('AI settings unavailable');
        history.complete(email,requestId,reply,{inputTokens:hasUsage&&completeTokens?inputTokens:null,outputTokens:hasUsage&&completeTokens?outputTokens:null,cost:hasUsage&&completeCost?cost:null,durationMs:Date.now()-started});
      } catch(error) {
        const known=['Tool request limit reached','Too many tool calls','Invalid tool calls','OpenRouter returned no message','OpenRouter returned no text','Malformed OpenRouter JSON'];const reason=error instanceof Error && (/^OpenRouter HTTP \d{3}$/.test(error.message)||known.includes(error.message))?error.message:error instanceof Error && (error.name==='TimeoutError'||error.name==='AbortError')?'OpenRouter request timed out':error instanceof TypeError?'OpenRouter network or response error':'AI request failed';
        console.error(`Music Shelf assistant: ${reason}`);
        try {history.fail(email,requestId);} catch { /* A pending turn is marked failed after restart. */ }
      }
    })();
    response.status(202).json({requestId,state:'pending'});
  });
  app.get('/api/catalog', authorize, (request, response) => {
    try {
      const raw = { ...request.query, ...(typeof request.query.filters === 'string' ? { filters: JSON.parse(request.query.filters) } : {}) };
      const parsed = catalogQuerySchema.safeParse(raw);
      if (!parsed.success) { response.status(400).json({ error: 'Invalid catalog query' }); return; }
      const catalog=options.store.catalogPage(parsed.data,response.locals.email);
      const tagsByTrack=options.features?.tags.forTracks(response.locals.email,catalog.tracks.map(track=>track.id)) ?? {};
      const tagOptions=options.features?.tags.options(response.locals.email) ?? [];
      response.json({ ...catalog, tagsByTrack, tagOptions, demo: Boolean(options.demo) });
    } catch { response.status(400).json({ error: 'Invalid catalog query' }); }
  });
  app.get('/api/history', authorize, (request, response) => {
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    const cursor = request.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (cursor !== undefined && typeof cursor !== 'string') || (typeof cursor === 'string' && cursor.length > 1000)) { response.status(400).json({ error: 'Invalid pagination' }); return; }
    const { kind, from, to } = request.query;
    if ([kind, from, to].some(value => value !== undefined && typeof value !== 'string')) { response.status(400).json({ error: 'Invalid history filters' }); return; }
    const filters = historyFilterSchema.safeParse({ kinds: typeof kind === 'string' ? kind.split(',') : undefined, from, to });
    if (!filters.success) { response.status(400).json({ error: 'Invalid history filters' }); return; }
    try { response.json(options.store.history(limit, cursor, filters.data)); }
    catch { response.status(400).json({ error: 'Invalid history cursor' }); }
  });
  app.post(['/api/bridge/claim','/api/bridge/complete','/api/bridge/selections'], express.raw({type:'application/json',limit:'300kb'}), (request,response) => {
    if (!options.publisherKey || !options.bridge) {response.status(503).json({error:'Bridge unavailable'});return;}
    const timestamp=request.get('X-Shelf-Timestamp') ?? '', signature=request.get('X-Shelf-Signature') ?? '';
    if (!/^\d{10}$/.test(timestamp) || Math.abs(now()-Number(timestamp)*1000)>120000 || !Buffer.isBuffer(request.body)) {response.status(400).json({error:'Invalid request'});return;}
    try {
      const signed=Buffer.concat([Buffer.from(timestamp+'\n'+request.path+'\n'),request.body]);
      if (!verify(null,signed,options.publisherKey,Buffer.from(signature,'base64'))) {response.status(403).json({error:'Invalid signature'});return;}
      const body=JSON.parse(request.body.toString('utf8')) as {nonce?:unknown;id?:unknown;result?:unknown};
      if(typeof body.nonce!=='string' || !/^[a-f0-9]{32}$/.test(body.nonce) || !options.bridge.nonce(body.nonce,now())) {response.status(403).json({error:'Invalid or repeated request'});return;}
      if(request.path.endsWith('/claim')) {response.json({job:options.bridge.claim()});return;}
      if(request.path.endsWith('/selections')) {
        if (!options.features || options.queueUsers?.length !== 1) {response.status(503).json({error:'Selection synchronization is not configured for exactly one owner'});return;}
        const selections=options.features.tags.list(options.queueUsers[0]).map(({id,name,trackIds})=>({id,name,trackIds}));
        response.json({selections});return;
      }
      if(typeof body.id!=='string' || !/^[a-f0-9-]{36}$/.test(body.id) || typeof body.result!=='object' || !body.result) {response.status(400).json({error:'Invalid result'});return;}
      response.json({ok:options.bridge.complete(body.id,body.result)});
    } catch {response.status(400).json({error:'Invalid bridge request'});}
  });
  app.post('/api/import', express.raw({ type: 'application/json', limit: '8mb' }), (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!options.publisherKey) { response.status(503).json({ error: 'Snapshot publishing is not configured' }); return; }
    const timestamp = request.get('X-Shelf-Timestamp') ?? '';
    const signature = request.get('X-Shelf-Signature') ?? '';
    if (!/^\d{10,12}$/.test(timestamp) || Math.abs(now() - Number(timestamp) * 1000) > 300000 || !Buffer.isBuffer(request.body)) { response.status(400).json({ error: 'Invalid request timestamp or body' }); return; }
    try {
      const bytes = Buffer.from(signature, 'base64');
      if (bytes.length !== 64 || !verify(null, Buffer.concat([Buffer.from(timestamp + '\n'), request.body]), options.publisherKey, bytes)) { response.status(403).json({ error: 'Invalid publisher signature' }); return; }
      const parsed = snapshotSchema.safeParse(JSON.parse(request.body.toString('utf8')));
      if (!parsed.success || new Date(parsed.data.generatedAt).getTime() > now() + 300000) { response.status(400).json({ error: 'Invalid catalog snapshot' }); return; }
      const result = options.store.import(parsed.data);
      response.json({ ok: true, tracks: parsed.data.tracks.length, ...result });
    } catch (error) {
      response.status(error instanceof SnapshotConflict ? 409 : 400).json({ error: error instanceof SnapshotConflict ? error.message : 'Invalid catalog snapshot' });
    }
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));
  const directory = resolve(options.clientDirectory ?? 'dist/client');
  if (existsSync(directory)) {
    app.use(express.static(directory, { index: 'index.html', setHeaders: (response, file) => { response.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'); } }));
  }
  app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
  app.use((error: { status?: number }, _request: Request, response: Response, _next: NextFunction) => { response.status(error.status === 413 ? 413 : error.status === 400 ? 400 : 500).json({ error: error.status === 413 ? 'Request too large' : 'Request failed' }); });
  return app;
}
