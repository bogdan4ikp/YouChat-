import postgres from 'postgres';
import { put, get } from '@vercel/blob';
import crypto from 'node:crypto';

const db = postgres(process.env.DATABASE_URL || process.env.POSTGRES_URL, { max: 1, prepare: false, ssl: 'require' });
const COOKIE='youchat_sid', OAUTH='youchat_oauth', TTL=30*86400;
const now=()=>Date.now(), id=p=>p+crypto.randomBytes(9).toString('base64url');
const q=(s,p=[])=>db.unsafe(s,p);
const cookies=h=>Object.fromEntries(String(h||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?['','']:[x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
const send=(r,c,d,h={})=>{r.statusCode=c;r.setHeader('content-type','application/json; charset=utf-8');r.setHeader('cache-control','no-store');Object.entries(h).forEach(([k,v])=>r.setHeader(k,v));r.end(JSON.stringify(d));};
const fail=(r,c,e)=>send(r,c,{error:e});
const cookie=(n,v,a)=>n+'='+v+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+a+'; Secure';
const read=async req=>{if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4*1024*1024)throw Object.assign(new Error('Слишком большой запрос'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(new Error('Некорректный JSON'),{status:400});}};
const parse=(v,d)=>{try{return typeof v==='string'?JSON.parse(v):v??d;}catch{return d;}};
let initialized;
async function init(){
 if(!initialized)initialized=(async()=>{
  await q("CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,username text UNIQUE NOT NULL,name text NOT NULL,grad int DEFAULT 0,accent text DEFAULT '#e6e2d8',custom text DEFAULT '',bio text DEFAULT '',banner text DEFAULT 'mono',banner_img text DEFAULT '',avatar text,yandex_id text UNIQUE,email text DEFAULT '',birthday text DEFAULT '',onboarded boolean DEFAULT false,created bigint NOT NULL,last_seen bigint DEFAULT 0)");
  await q("CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id text REFERENCES users(id) ON DELETE CASCADE,created bigint,seen bigint)");
  await q("CREATE TABLE IF NOT EXISTS conversations(id text PRIMARY KEY,type text NOT NULL,peer_key text UNIQUE,name text DEFAULT '',handle text UNIQUE,grad int DEFAULT 0,icon text DEFAULT '',banner text DEFAULT 'mono',banner_img text DEFAULT '',avatar text DEFAULT '',descr text DEFAULT '',access text DEFAULT 'closed',requests_on boolean DEFAULT true,perms jsonb DEFAULT '{}'::jsonb,created bigint,deleted boolean DEFAULT false)");
  await q("CREATE TABLE IF NOT EXISTS members(conv_id text REFERENCES conversations(id) ON DELETE CASCADE,user_id text REFERENCES users(id) ON DELETE CASCADE,role text DEFAULT 'member',joined bigint,last_read bigint DEFAULT 0,pinned boolean DEFAULT false,hidden boolean DEFAULT false,PRIMARY KEY(conv_id,user_id))");
  await q("CREATE TABLE IF NOT EXISTS messages(id text PRIMARY KEY,conv_id text REFERENCES conversations(id) ON DELETE CASCADE,author text REFERENCES users(id),t bigint,text text DEFAULT '',att jsonb DEFAULT '[]'::jsonb,react jsonb DEFAULT '{}'::jsonb,reply text,pinned boolean DEFAULT false,deleted boolean DEFAULT false,edited_at bigint,sys text,forwarded_from text)");
  await q("CREATE TABLE IF NOT EXISTS hides(msg_id text,user_id text,PRIMARY KEY(msg_id,user_id))");
  await q("CREATE TABLE IF NOT EXISTS pins(conv_id text,msg_id text,t bigint,PRIMARY KEY(conv_id,msg_id))");
  await q("CREATE TABLE IF NOT EXISTS join_requests(id text PRIMARY KEY,conv_id text,user_id text,created bigint,UNIQUE(conv_id,user_id))");
  await q("CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,conv_id text,by_user text,t bigint,text text)");
  await q("CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conv_id,t)");
  await q("CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id)");
 })().catch(e=>{initialized=null;throw e;});
 return initialized;
}
const userFor=async req=>{const t=cookies(req.headers.cookie)[COOKIE];if(!t)return null;const a=await q('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.seen>$2',[t,now()-TTL*1000]);if(!a[0])return null;await q('UPDATE sessions SET seen=$1 WHERE token=$2',[now(),t]);await q('UPDATE users SET last_seen=$1 WHERE id=$2',[now(),a[0].id]);return a[0];};
const person=u=>({id:u.id,name:u.name,username:u.username,grad:u.grad||0,accent:u.accent||'#e6e2d8',custom:u.custom||'',bio:u.bio||'',banner:u.banner||'mono',bannerImg:u.banner_img||'',avatar:u.avatar||null,status:now()-Number(u.last_seen||0)<300000?'idle':'offline',joined:new Date(Number(u.created)).toISOString().slice(0,10)});
const validUser=s=>/^[a-z0-9_]{3,24}$/.test(s),validHandle=s=>/^[a-z0-9-]{3,24}$/.test(s);
const getMember=async(c,u)=>(await q('SELECT * FROM members WHERE conv_id=$1 AND user_id=$2',[c,u]))[0]||null;
const getConv=async c=>(await q('SELECT * FROM conversations WHERE id=$1 AND deleted=false',[c]))[0]||null;
const msg=m=>({id:m.id,author:m.author,t:Number(m.t),text:m.text,att:parse(m.att,[]),react:parse(m.react,{}),reply:m.reply||null,pinned:!!m.pinned,deleted:!!m.deleted,editedAt:m.edited_at?Number(m.edited_at):null,sys:m.sys||null,forwardedFrom:m.forwarded_from||null});
async function state(uid){
 const cs=await q('SELECT c.*,m.role my_role,m.last_read my_last_read,m.pinned my_pinned FROM conversations c JOIN members m ON m.conv_id=c.id WHERE m.user_id=$1 AND m.hidden=false AND c.deleted=false ORDER BY c.created',[uid]);
 const hidden=await q('SELECT msg_id FROM hides WHERE user_id=$1',[uid]),hs=new Set(hidden.map(x=>x.msg_id)),ids=new Set([uid]),conversations=[];
 for(const c of cs){
  const members=await q('SELECT * FROM members WHERE conv_id=$1 AND hidden=false',[c.id]),roles={};members.forEach(x=>{roles[x.user_id]=x.role;ids.add(x.user_id)});
  const rows=await q('SELECT * FROM messages WHERE conv_id=$1 ORDER BY t',[c.id]),messages=rows.filter(x=>!hs.has(x.id)).map(x=>{ids.add(x.author);return msg(x)});
  const pins=await q('SELECT msg_id FROM pins WHERE conv_id=$1 ORDER BY t',[c.id]),admin=['owner','admin'].includes(c.my_role);
  const requests=admin?await q('SELECT * FROM join_requests WHERE conv_id=$1 ORDER BY created',[c.id]):[],audits=admin?await q('SELECT * FROM audit WHERE conv_id=$1 ORDER BY t DESC LIMIT 50',[c.id]):[];
  requests.forEach(x=>ids.add(x.user_id));audits.forEach(x=>ids.add(x.by_user));
  conversations.push({id:c.id,type:c.type,peer:c.type==='dm'?(members.map(x=>x.user_id).find(x=>x!==uid)||uid):null,name:c.name,handle:c.handle||'',grad:c.grad||0,icon:c.icon||'',banner:c.banner||'mono',bannerImg:c.banner_img||'',avatar:c.avatar||'',desc:c.descr||'',access:c.access,requestsOn:!!c.requests_on,perms:parse(c.perms,{}),created:Number(c.created),members:members.map(x=>x.user_id),roles,messages,pinnedMsgs:pins.map(x=>x.msg_id),joinRequests:requests.map(x=>({id:x.id,personId:x.user_id,at:Number(x.created)})),audit:audits.map(x=>({t:Number(x.t),by:x.by_user,text:x.text})),unread:rows.filter(x=>!hs.has(x.id)&&x.author!==uid&&!x.sys&&Number(x.t)>Number(c.my_last_read||0)).length,pinned:!!c.my_pinned});
 }
 const people={};if(ids.size){const us=await q('SELECT * FROM users WHERE id=ANY($1::text[])',[Array.from(ids)]);us.forEach(x=>people[x.id]=person(x));}
 const me=(await q('SELECT onboarded,birthday,yandex_id,email FROM users WHERE id=$1',[uid]))[0]||{};
 return {v:3,me:uid,profile:{onboarded:!!me.onboarded,birthday:me.birthday||'',yandex:!!me.yandex_id,email:me.email||''},people,conversations,serverNow:now()};
}
async function openDm(a,b){
 const key=[a,b].sort().join(':');let c=(await q("SELECT * FROM conversations WHERE peer_key=$1 AND deleted=false",[key]))[0];
 if(!c){const cid=id('dm');await db.begin(async tx=>{await tx.unsafe("INSERT INTO conversations(id,type,peer_key,created) VALUES($1,'dm',$2,$3) ON CONFLICT(peer_key) DO NOTHING",[cid,key,now()]);c=(await tx.unsafe('SELECT * FROM conversations WHERE peer_key=$1',[key]))[0];await tx.unsafe("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'member',$3),($1,$4,'member',$3) ON CONFLICT DO NOTHING",[c.id,a,now(),b]);});}
 await q('UPDATE members SET hidden=false WHERE conv_id=$1 AND user_id=$2',[c.id,a]);return c;
}
export default async function handler(req,res){
 res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','same-origin');
 try{
  await init();const u=new URL(req.url,'https://www.youchat-msg.ru'),p=u.pathname,m=req.method;
  if(p==='/api/health')return send(res,200,{ok:true,name:'YouChat server',time:now(),yandex:!!(process.env.YANDEX_CLIENT_ID&&process.env.YANDEX_CLIENT_SECRET),database:'connected',storage:!!process.env.BLOB_READ_WRITE_TOKEN});
  if((p==='/api/auth/login'||p==='/api/auth/register')&&m==='POST')return fail(res,403,'Вход и регистрация доступны только через Яндекс ID');
  if(p==='/api/auth/yandex/start'&&m==='GET'){
   if(!process.env.YANDEX_CLIENT_ID||!process.env.YANDEX_CLIENT_SECRET){res.statusCode=302;res.setHeader('location','/?auth=yandex_unconfigured');return res.end();}
   const s=crypto.randomBytes(24).toString('base64url'),t=new URL('https://oauth.yandex.ru/authorize');t.searchParams.set('response_type','code');t.searchParams.set('client_id',process.env.YANDEX_CLIENT_ID);t.searchParams.set('redirect_uri','https://www.youchat-msg.ru/api/auth/yandex/callback');t.searchParams.set('state',s);t.searchParams.set('force_confirm','yes');res.statusCode=302;res.setHeader('set-cookie',cookie(OAUTH,s,600));res.setHeader('location',t.toString());return res.end();
  }
  if(p==='/api/auth/yandex/callback'&&m==='GET'){
   const ck=cookies(req.headers.cookie),code=u.searchParams.get('code'),s=u.searchParams.get('state');
   try{
    if(!code)throw Error('cancelled');if(!s||s!==ck[OAUTH])throw Error('state');
    const tr=await fetch('https://oauth.yandex.ru/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:process.env.YANDEX_CLIENT_ID,client_secret:process.env.YANDEX_CLIENT_SECRET,redirect_uri:'https://www.youchat-msg.ru/api/auth/yandex/callback'}),signal:AbortSignal.timeout(15000)}),td=await tr.json();if(!tr.ok||!td.access_token)throw Error('token');
    const pr=await fetch('https://login.yandex.ru/info?format=json',{headers:{authorization:'OAuth '+td.access_token},signal:AbortSignal.timeout(15000)}),info=await pr.json();if(!pr.ok||!info.id)throw Error('profile');
    let user=(await q('SELECT * FROM users WHERE yandex_id=$1',[String(info.id)]))[0];
    if(!user){const name=String(info.display_name||info.real_name||[info.first_name,info.last_name].filter(Boolean).join(' ')||info.login||'Пользователь').trim().slice(0,32)||'Пользователь';let base=String(info.login||name).toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,15);if(base.length<3)base='user';let username=base;for(let i=1;(await q('SELECT id FROM users WHERE username=$1',[username])).length;i++)username=(base+'_'+i).slice(0,24);const avatar=info.default_avatar_id&&!info.is_avatar_empty?'https://avatars.yandex.net/get-yapic/'+info.default_avatar_id+'/islands-200':null,ts=now();user=(await q('INSERT INTO users(id,username,name,yandex_id,email,avatar,birthday,onboarded,created,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,false,$8,$8) RETURNING *',[id('u'),username,name,String(info.id),String(info.default_email||''),avatar,String(info.birthday||'').slice(0,10),ts]))[0];}
    else user=(await q('UPDATE users SET last_seen=$1,email=$2 WHERE id=$3 RETURNING *',[now(),String(info.default_email||''),user.id]))[0];
    const token=crypto.randomBytes(32).toString('hex');await q('INSERT INTO sessions(token,user_id,created,seen) VALUES($1,$2,$3,$3)',[token,user.id,now()]);res.statusCode=302;res.setHeader('set-cookie',[cookie(COOKIE,token,TTL),'youchat_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure']);res.setHeader('location',user.onboarded?'/?auth=yandex_ok':'/?onboarding=1');return res.end();
   }catch(e){res.statusCode=302;res.setHeader('set-cookie','youchat_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');res.setHeader('location','/?auth=yandex_error&reason='+encodeURIComponent(e.message||'error'));return res.end();}
  }
  if(p==='/api/auth/logout'&&m==='POST'){const t=cookies(req.headers.cookie)[COOKIE];if(t)await q('DELETE FROM sessions WHERE token=$1',[t]);return send(res,200,{ok:true},{'set-cookie':'youchat_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'});}
  const user=await userFor(req);
  if(p==='/api/stream'&&m==='GET')return send(res,200,{ok:true,polling:true});
  if(p==='/api/state'&&m==='GET'){if(!user)return fail(res,401,'Требуется вход');return send(res,200,{state:await state(user.id)});}
  if(p==='/api/me'&&m==='GET'){if(!user)return fail(res,401,'Требуется вход');return send(res,200,{person:person(user)});}
  if(p==='/api/username'&&m==='GET'){if(!user)return fail(res,401,'Требуется вход');const n=(u.searchParams.get('u')||'').toLowerCase().replace(/^@/,'');const ok=validUser(n)&&!(await q('SELECT id FROM users WHERE username=$1 AND id<>$2',[n,user.id])).length;return send(res,200,{username:n,available:ok,reason:ok?'':'taken'});}
  if(p==='/api/users'&&m==='GET'){if(!user)return fail(res,401,'Требуется вход');const term=(u.searchParams.get('q')||'').toLowerCase().replace(/^@/,'');if(term.length<2)return send(res,200,{users:[]});const rows=await q('SELECT * FROM users WHERE id<>$1 AND (username ILIKE $2 OR name ILIKE $2) ORDER BY username LIMIT 24',[user.id,'%'+term+'%']),users=[];for(const x of rows){const d=(await q('SELECT id FROM conversations WHERE peer_key=$1 AND deleted=false',[[user.id,x.id].sort().join(':')]))[0];users.push({...person(x),dmId:d?.id||null});}return send(res,200,{users});}
  if(p==='/api/dm'&&m==='POST'){if(!user)return fail(res,401,'Требуется вход');const b=await read(req),peer=String(b.peerId||'');if(peer===user.id)return fail(res,400,'Нельзя открыть переписку с собой');if(!(await q('SELECT id FROM users WHERE id=$1',[peer])).length)return fail(res,404,'Пользователь не найден');const c=await openDm(user.id,peer);return send(res,200,{convId:c.id,state:await state(user.id)});}
  if(p==='/api/profile'&&m==='PATCH'){if(!user)return fail(res,401,'Требуется вход');const b=await read(req),name=String(b.name??user.name).trim().slice(0,32),username=String(b.username??user.username).trim().toLowerCase(),birthday=String(b.birthday??user.birthday??'');if(name.length<2||!validUser(username)||!/^(\d{4}-\d{2}-\d{2})?$/.test(birthday))return fail(res,400,'Проверьте имя, логин и дату рождения');if((await q('SELECT id FROM users WHERE username=$1 AND id<>$2',[username,user.id])).length)return fail(res,409,'Этот адрес уже занят');const x=(await q("UPDATE users SET name=$1,username=$2,bio=$3,custom=$4,grad=$5,banner=$6,banner_img=$7,avatar=$8,birthday=$9,onboarded=$10 WHERE id=$11 RETURNING *",[name,username,String(b.bio??user.bio).slice(0,190),String(b.custom??user.custom).slice(0,48),Number(b.grad??user.grad)||0,String(b.banner??user.banner),String(b.bannerImg??user.banner_img),b.avatar===null?null:String(b.avatar??user.avatar??''),birthday,b.complete===true||user.onboarded,user.id]))[0];return send(res,200,{person:person(x),state:await state(user.id)});}
  if(p==='/api/conversations'&&m==='POST'){if(!user)return fail(res,401,'Требуется вход');const b=await read(req),name=String(b.name||'').trim(),handle=String(b.handle||'').trim().toLowerCase();if(name.length<2||name.length>40||!validHandle(handle))return fail(res,400,'Проверьте название и адрес группы');const cid=id('g'),ts=now();try{await db.begin(async tx=>{await tx.unsafe("INSERT INTO conversations(id,type,name,handle,grad,icon,banner,banner_img,avatar,descr,access,requests_on,perms,created) VALUES($1,'group',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)",[cid,name,handle,Number(b.grad)||0,String(b.icon||name.slice(0,2)).slice(0,4),String(b.banner||'mono'),String(b.bannerImg||''),String(b.avatar||''),String(b.desc||'').slice(0,220),b.access==='open'?'open':'closed',b.requestsOn!==false,JSON.stringify({admins:{deleteMessages:true,removeMembers:true,acceptRequests:true}}),ts]);await tx.unsafe("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'owner',$3)",[cid,user.id,ts]);await tx.unsafe('INSERT INTO messages(id,conv_id,author,t,sys) VALUES($1,$2,$3,$4,$5)',[id('m'),cid,user.id,ts,user.name+' создал(а) группу «'+name+'»']);});}catch(e){if(e.code==='23505')return fail(res,409,'Такой адрес уже занят');throw e;}return send(res,200,{convId:cid,state:await state(user.id)});}
  const mm=p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if(mm&&m==='POST'){if(!user)return fail(res,401,'Требуется вход');const cid=mm[1],c=await getConv(cid),mem=await getMember(cid,user.id);if(!c||!mem)return fail(res,403,'Нет доступа');const b=await read(req),text=String(b.text||'').slice(0,4000),att=Array.isArray(b.att)?b.att.slice(0,10):[];if(!text.trim()&&!att.length)return fail(res,400,'Пустое сообщение');const x=(await q('INSERT INTO messages(id,conv_id,author,t,text,att,reply,forwarded_from) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *',[id('m'),cid,user.id,now(),text,JSON.stringify(att),b.reply||null,b.forwardedFrom||null]))[0];return send(res,200,{message:msg(x)});}
  if(p==='/api/upload'&&m==='POST'){if(!user)return fail(res,401,'Требуется вход');if(!process.env.BLOB_READ_WRITE_TOKEN)return fail(res,503,'Vercel Blob не настроен');const type=String(req.headers['content-type']||'');if(!/^(image|video|audio)\//.test(type))return fail(res,415,'Неподдерживаемый тип файла');const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4*1024*1024)return fail(res,413,'Файл превышает лимит загрузки 4 МБ');chunks.push(c);}const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/ogg':'ogg','audio/mp4':'m4a'})[type]||'bin';const blob=await put(id('f')+'.'+ext,Buffer.concat(chunks),{access:'private',contentType:type,addRandomSuffix:true});return send(res,200,{url:'/api/blob?pathname='+encodeURIComponent(blob.pathname),size,type});}
  if(p==='/api/blob'&&m==='GET'){
   if(!user)return fail(res,401,'Требуется вход');
   const pathname=u.searchParams.get('pathname')||'';
   if(!pathname||pathname.includes('..')||pathname.startsWith('/'))return fail(res,400,'Некорректный файл');
   const owned=await q("SELECT 1 FROM users WHERE id=$1 AND (COALESCE(avatar,'') LIKE $2 OR COALESCE(banner_img,'') LIKE $2) UNION SELECT 1 FROM messages m JOIN members mb ON mb.conv_id=m.conv_id WHERE mb.user_id=$1 AND m.att::text LIKE $2 LIMIT 1",[user.id,'%'+pathname+'%']);
   if(!owned.length)return fail(res,404,'Файл не найден');
   const blob=await get(pathname,{access:'private'});
   if(!blob||blob.statusCode!==200)return fail(res,404,'Файл не найден');
   res.statusCode=200;res.setHeader('content-type',blob.blob.contentType||'application/octet-stream');res.setHeader('cache-control','private, max-age=300');res.setHeader('x-content-type-options','nosniff');
   for await(const chunk of blob.stream)res.write(chunk);
   return res.end();
  }
  if(p==='/api/groups/by-handle'&&m==='GET'){
   if(!user)return fail(res,401,'Требуется вход');
   const h=(u.searchParams.get('handle')||'').toLowerCase();
   const c=(await q("SELECT * FROM conversations WHERE type='group' AND handle=$1 AND deleted=false",[h]))[0];
   if(!c)return fail(res,404,'Группа не найдена');
   const mem=await getMember(c.id,user.id),reqRow=(await q('SELECT id FROM join_requests WHERE conv_id=$1 AND user_id=$2',[c.id,user.id]))[0],count=(await q('SELECT count(*)::int n FROM members WHERE conv_id=$1 AND hidden=false',[c.id]))[0].n;
   return send(res,200,{group:{id:c.id,name:c.name,handle:c.handle,desc:c.descr,grad:c.grad,avatar:c.avatar,banner:c.banner,bannerImg:c.banner_img,access:c.access,members:count,isMember:!!mem,requested:!!reqRow,requestsOn:!!c.requests_on}});
  }
  const editMatch=p.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/);
  if(editMatch&&m==='PATCH'){
   if(!user)return fail(res,401,'Требуется вход');
   const cid=editMatch[1],mid=editMatch[2],mem=await getMember(cid,user.id),row=(await q('SELECT * FROM messages WHERE id=$1 AND conv_id=$2',[mid,cid]))[0];
   if(!mem||!row)return fail(res,404,'Сообщение не найдено');
   if(row.author!==user.id)return fail(res,403,'Можно менять только свои сообщения');
   if(now()-Number(row.t)>86400000)return fail(res,400,'Время редактирования истекло');
   const b=await read(req),text=String(b.text||'').slice(0,4000);if(!text.trim())return fail(res,400,'Текст не может быть пустым');
   const updated=(await q('UPDATE messages SET text=$1,edited_at=$2 WHERE id=$3 RETURNING *',[text,now(),mid]))[0];return send(res,200,{message:msg(updated)});
  }
  const delMatch=p.match(/^\/api\/conversations\/([^/]+)\/messages\/delete$/);
  if(delMatch&&m==='POST'){
   if(!user)return fail(res,401,'Требуется вход');const cid=delMatch[1],mem=await getMember(cid,user.id);if(!mem)return fail(res,403,'Нет доступа');
   const b=await read(req),ids=Array.isArray(b.ids)?b.ids.map(String).slice(0,200):[];
   for(const mid of ids){const row=(await q('SELECT * FROM messages WHERE id=$1 AND conv_id=$2',[mid,cid]))[0];if(!row)continue;
    if(row.author===user.id||['owner','admin'].includes(mem.role)){await q("UPDATE messages SET deleted=true,text='',att='[]'::jsonb,react='{}'::jsonb,edited_at=NULL WHERE id=$1",[mid]);await q('DELETE FROM pins WHERE msg_id=$1',[mid]);await q('DELETE FROM hides WHERE msg_id=$1',[mid]);}
    else await q('INSERT INTO hides(msg_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[mid,user.id]);
   }return send(res,200,{ok:true});
  }
  const reactionMatch=p.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/(reaction|pin)$/);
  if(reactionMatch&&m==='POST'){
   if(!user)return fail(res,401,'Требуется вход');const cid=reactionMatch[1],mid=reactionMatch[2],action=reactionMatch[3],mem=await getMember(cid,user.id);
   const row=(await q('SELECT * FROM messages WHERE id=$1 AND conv_id=$2',[mid,cid]))[0];if(!mem||!row)return fail(res,404,'Сообщение не найдено');
   if(action==='reaction'){const b=await read(req),emoji=String(b.emoji||'').slice(0,12);if(!emoji)return fail(res,400,'Нет эмодзи');const reacts=parse(row.react,{}),list=Array.isArray(reacts[emoji])?reacts[emoji]:[],i=list.indexOf(user.id);if(i>=0)list.splice(i,1);else list.push(user.id);if(list.length)reacts[emoji]=list;else delete reacts[emoji];await q('UPDATE messages SET react=$1::jsonb WHERE id=$2',[JSON.stringify(reacts),mid]);return send(res,200,{react:reacts});}
   const pinned=!row.pinned;await q('UPDATE messages SET pinned=$1 WHERE id=$2',[pinned,mid]);if(pinned)await q('INSERT INTO pins(conv_id,msg_id,t) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[cid,mid,now()]);else await q('DELETE FROM pins WHERE msg_id=$1',[mid]);return send(res,200,{pinned});
  }
  const groupMatch=p.match(/^\/api\/conversations\/([^/]+)(?:\/(read|pin|leave|join|members|transfer|requests\/accept-all))?(?:\/members\/([^/]+)(?:\/(role))?)?(?:\/requests\/([^/]+))?$/);
  if(groupMatch){
   if(!user)return fail(res,401,'Требуется вход');
   const cid=groupMatch[1],action=groupMatch[2],target=groupMatch[3],sub=groupMatch[4],requestId=groupMatch[5],c=await getConv(cid),mem=await getMember(cid,user.id);
   if(!c)return fail(res,404,'Беседа не найдена');
   if(action==='read'&&m==='POST'){if(!mem)return fail(res,404,'Беседа не найдена');await q('UPDATE members SET last_read=$1 WHERE conv_id=$2 AND user_id=$3',[now(),cid,user.id]);return send(res,200,{ok:true});}
   if(action==='pin'&&m==='POST'){if(!mem)return fail(res,404,'Беседа не найдена');const b=await read(req);await q('UPDATE members SET pinned=$1 WHERE conv_id=$2 AND user_id=$3',[!!b.pinned,cid,user.id]);return send(res,200,{pinned:!!b.pinned});}
   if(action==='leave'&&m==='DELETE'){if(!mem)return fail(res,404,'Вы не участник');if(c.type==='group'&&mem.role==='owner'){const n=(await q('SELECT count(*)::int n FROM members WHERE conv_id=$1 AND user_id<>$2 AND hidden=false',[cid,user.id]))[0].n;if(n)return fail(res,400,'Сначала передайте владение другому участнику');await q('UPDATE conversations SET deleted=true WHERE id=$1',[cid]);}else if(c.type==='group'){await q('INSERT INTO messages(id,conv_id,author,t,sys) VALUES($1,$2,$3,$4,$5)',[id('m'),cid,user.id,now(),user.name+' покинул(а) группу']);await q('DELETE FROM members WHERE conv_id=$1 AND user_id=$2',[cid,user.id]);}else await q('UPDATE members SET hidden=true WHERE conv_id=$1 AND user_id=$2',[cid,user.id]);return send(res,200,{ok:true});}
   if(action==='join'&&m==='POST'){if(c.type!=='group')return fail(res,404,'Группа не найдена');if(mem){await q('UPDATE members SET hidden=false WHERE conv_id=$1 AND user_id=$2',[cid,user.id]);return send(res,200,{status:'member',convId:cid,state:await state(user.id)});}if(c.access==='open'||!c.requests_on){await q("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING",[cid,user.id,now()]);await q('INSERT INTO messages(id,conv_id,author,t,sys) VALUES($1,$2,$3,$4,$5)',[id('m'),cid,user.id,now(),user.name+' вступил(а) в группу']);return send(res,200,{status:'member',convId:cid,state:await state(user.id)});}await q('INSERT INTO join_requests(id,conv_id,user_id,created) VALUES($1,$2,$3,$4) ON CONFLICT(conv_id,user_id) DO NOTHING',[id('r'),cid,user.id,now()]);return send(res,200,{status:'requested',convId:cid});}
   if(action==='members'&&m==='POST'){if(!['owner','admin'].includes(mem?.role))return fail(res,403,'Недостаточно прав');const b=await read(req),ids=Array.isArray(b.ids)?b.ids.map(String).slice(0,50):[];let added=0;for(const x of ids){if(x===user.id)continue;const exists=await getMember(cid,x);if(exists){if(exists.hidden)await q('UPDATE members SET hidden=false WHERE conv_id=$1 AND user_id=$2',[cid,x]);continue;}const ok=(await q('SELECT id FROM users WHERE id=$1',[x])).length;if(ok){await q("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'member',$3)",[cid,x,now()]);added++;}}return send(res,200,{added,state:await state(user.id)});}
   if(action==='transfer'&&m==='POST'){if(mem?.role!=='owner')return fail(res,403,'Только владелец передаёт владение');const b=await read(req),to=String(b.userId||''),tm=await getMember(cid,to);if(!tm||to===user.id)return fail(res,400,'Передать можно только участнику группы');await q("UPDATE members SET role='admin' WHERE conv_id=$1 AND role='owner'",[cid]);await q("UPDATE members SET role='owner' WHERE conv_id=$1 AND user_id=$2",[cid,to]);return send(res,200,{state:await state(user.id)});}
   if(target&&sub==='role'&&m==='POST'){if(mem?.role!=='owner')return fail(res,403,'Только владелец меняет роли');const tm=await getMember(cid,target);if(!tm||tm.role==='owner')return fail(res,404,'Участник не найден');const b=await read(req);await q('UPDATE members SET role=$1 WHERE conv_id=$2 AND user_id=$3',[b.role==='admin'?'admin':'member',cid,target]);return send(res,200,{state:await state(user.id)});}
   if(target&&m==='DELETE'){if(!['owner','admin'].includes(mem?.role)||target===user.id)return fail(res,403,'Недостаточно прав');const tm=await getMember(cid,target);if(!tm||tm.role==='owner'||(mem.role==='admin'&&tm.role!=='member'))return fail(res,403,'Недостаточно прав');await q('DELETE FROM members WHERE conv_id=$1 AND user_id=$2',[cid,target]);await q('DELETE FROM join_requests WHERE conv_id=$1 AND user_id=$2',[cid,target]);return send(res,200,{state:await state(user.id)});}
   if(action==='requests/accept-all'&&m==='POST'){if(!['owner','admin'].includes(mem?.role))return fail(res,403,'Недостаточно прав');const rs=await q('SELECT * FROM join_requests WHERE conv_id=$1',[cid]);for(const x of rs){await q("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING",[cid,x.user_id,now()]);await q('DELETE FROM join_requests WHERE id=$1',[x.id]);}return send(res,200,{accepted:rs.length,state:await state(user.id)});}
   if(requestId&&m==='POST'){if(!['owner','admin'].includes(mem?.role))return fail(res,403,'Недостаточно прав');const b=await read(req),rr=(await q('SELECT * FROM join_requests WHERE id=$1 AND conv_id=$2',[requestId,cid]))[0];if(!rr)return fail(res,404,'Заявка не найдена');await q('DELETE FROM join_requests WHERE id=$1',[requestId]);if(b.accept)await q("INSERT INTO members(conv_id,user_id,role,joined) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING",[cid,rr.user_id,now()]);return send(res,200,{state:await state(user.id)});}
  }
  if(p.startsWith('/api/conversations/')&&m==='PATCH'){
   if(!user)return fail(res,401,'Требуется вход');const cid=p.split('/')[3],c=await getConv(cid),mem=await getMember(cid,user.id);if(!c||c.type!=='group')return fail(res,404,'Группа не найдена');if(mem?.role!=='owner')return fail(res,403,'Только владелец меняет настройки');const b=await read(req),name=String(b.name??c.name).trim().slice(0,40),handle=String(b.handle??c.handle).trim().toLowerCase();if(name.length<2||!validHandle(handle))return fail(res,400,'Проверьте название и адрес');try{await q('UPDATE conversations SET name=$1,handle=$2,descr=$3,grad=$4,banner=$5,banner_img=$6,avatar=$7,access=$8,requests_on=$9,perms=$10::jsonb,icon=$11 WHERE id=$12',[name,handle,String(b.desc??c.descr).slice(0,220),Number(b.grad??c.grad)||0,String(b.banner??c.banner),String(b.bannerImg??c.banner_img),String(b.avatar??c.avatar),b.access===undefined?c.access:(b.access==='open'?'open':'closed'),b.requestsOn===undefined?c.requests_on:!!b.requestsOn,JSON.stringify(b.perms??parse(c.perms,{})),String(b.icon||name.slice(0,2)).slice(0,4),cid]);}catch(e){if(e.code==='23505')return fail(res,409,'Такой адрес уже занят');throw e;}return send(res,200,{state:await state(user.id)});
  }
  return fail(res,404,'Не найдено');
 }catch(e){console.error('YouChat API:',e);return fail(res,e.status||500,e.status?e.message:'Внутренняя ошибка сервера');}
}
