const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {Pool}=require("pg");
const {createClient}=require("@supabase/supabase-js");

const HOST=process.env.HOST||"0.0.0.0";
const PORT=Number(process.env.PORT||10000);
const PUBLIC=path.join(__dirname,"public");
const APP_SECRET=process.env.APP_SECRET;
const DATABASE_URL=process.env.DATABASE_URL;
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET=process.env.STORAGE_BUCKET||"chat-media";

if(!DATABASE_URL||!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!APP_SECRET){
  console.error("Missing DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or APP_SECRET");
  process.exit(1);
}
const pool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false},max:5,idleTimeoutMillis:30000});
const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const clients=new Set(),sessions=new Map(),rate=new Map();
const activeShare={owner:null,scope:null,target:null,startedAt:null};
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif"};
const now=()=>new Date().toISOString();

function cleanName(n){return typeof n==="string"&&/^[A-Za-z0-9À-ÿ _-]{3,24}$/.test(n.trim())?n.trim():null}
function passOk(p){return typeof p==="string"&&p.length>=4&&p.length<=72}
function hashPassword(password,salt=crypto.randomBytes(16).toString("hex")){return{salt,hash:crypto.scryptSync(password,salt,64).toString("hex")}}
function verifyPassword(password,row){try{const a=crypto.scryptSync(password,row.salt,64),b=Buffer.from(row.password_hash,"hex");return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch{return false}}
function token(){return crypto.randomBytes(32).toString("hex")}
function sessionUser(socket){return sessions.get(socket)}
function findSession(username){for(const[s,v]of sessions)if(v.username.toLowerCase()===username.toLowerCase())return s}
function convo(a,b){return"p:"+[a.toLowerCase(),b.toLowerCase()].sort().join(":")}
function wsSend(socket,obj){if(socket&&!socket.destroyed)frame(socket,JSON.stringify(obj))}
function frame(socket,text){const b=Buffer.from(text),n=b.length;if(n>65535)return;const h=n<126?Buffer.from([129,n]):Buffer.from([129,126,(n>>8)&255,n&255]);try{socket.write(Buffer.concat([h,b]))}catch{}}
function broadcast(obj,except=null){const t=JSON.stringify(obj);for(const c of clients)if(c!==except&&!c.destroyed)frame(c,t)}

async function q(text,params=[]){return pool.query(text,params).then(r=>r.rows)}
async function one(text,params=[]){const rows=await q(text,params);return rows[0]||null}
async function getUser(name){return one("select * from users where lower(username)=lower($1)",[name])}
async function getUsers(){return q("select username,bio,status,avatar,created_at,updated_at from users order by username")}
async function getPublicUsers(){const rows=await getUsers();return Promise.all(rows.map(async u=>({...u,avatar:u.avatar&&u.avatar.includes("/")?await signedUrl(u.avatar):u.avatar}))) }
async function getOnline(){return [...sessions.values()].map(v=>v.username)}
function shareFor(username){
 if(!activeShare.owner)return null;
 if(activeShare.owner.toLowerCase()===username.toLowerCase())return{owner:activeShare.owner,scope:activeShare.scope,target:activeShare.target,startedAt:activeShare.startedAt,self:true};
 if(activeShare.scope==="general")return{owner:activeShare.owner,scope:"general",startedAt:activeShare.startedAt,self:false};
 if(activeShare.scope==="private"&&activeShare.target?.toLowerCase()===username.toLowerCase())return{owner:activeShare.owner,scope:"private",target:activeShare.target,startedAt:activeShare.startedAt,self:false};
 return null;
}
async function getContacts(me){
 const users=await getPublicUsers(),out=[];
 for(const u of users){
  if(u.username.toLowerCase()===me.toLowerCase())continue;
  const last=await one("select sender as \"from\",recipient as \"to\",text,kind,created_at as timestamp from messages where conversation=$1 order by created_at desc limit 1",[convo(me,u.username)]);
  const unread=await one(`select count(*)::int as c from messages m where m.conversation=$1 and lower(m.sender)<>lower($2) and not exists(select 1 from reads r where r.message_id=m.id and lower(r.username)=lower($2))`,[convo(me,u.username),me]);
  out.push({...u,last:last||null,unread:Number(unread?.c||0),online:!!findSession(u.username)});
 }
 return out;
}
async function signedUrl(pathname){
 if(!pathname)return null;
 const {data,error}=await sb.storage.from(STORAGE_BUCKET).createSignedUrl(pathname,3600);
 if(error)throw error;
 return data.signedUrl;
}
async function hydrate(rows){
 return Promise.all(rows.map(async r=>({...r,type:r.kind==="audio"?"audio":r.kind==="image"?"image":(r.conversation==="general"?"message":"private"),url:r.media_path?await signedUrl(r.media_path):null})));
}
async function history(c){
 const rows=await q(`select id,conversation,sender as "from",recipient as "to",text,reply_to as "replyTo",edited,deleted,kind,media_path,duration,created_at as timestamp,updated_at as "updatedAt" from messages where conversation=$1 order by created_at desc limit 100`,[c]);
 return hydrate(rows.reverse());
}
async function sendDirectory(){
 const us=await getPublicUsers();
 for(const[s,v]of sessions)wsSend(s,{type:"directory",users:us.map(u=>({...u,online:!!findSession(u.username)})),contacts:await getContacts(v.username),share:shareFor(v.username)});
}
function canMessage(socket){
 const t=Date.now(),arr=(rate.get(socket)||[]).filter(x=>t-x<5000);arr.push(t);rate.set(socket,arr);return arr.length<=12;
}
function body(req,max){
 return new Promise((resolve,reject)=>{let total=0,ch=[];req.on("data",b=>{total+=b.length;if(total>max){req.destroy();reject(new Error("Arquivo excede o limite."));}else ch.push(b)});req.on("end",()=>resolve(Buffer.concat(ch)));req.on("error",reject)})
}
function json(res,code,obj){const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store","Content-Length":b.length});res.end(b)}
function getHeader(req,name){return String(req.headers[name.toLowerCase()]||"")}
function authHeader(req){
 const t=getHeader(req,"x-pikachu-session");
 for(const [socket,sess] of sessions)if(sess.token===t)return sess;
 return null;
}

async function profileUpdate(sess,x,socket){
 const bio=String(x.bio||"").slice(0,160),status=String(x.status||"Disponível").slice(0,40),avatar=String(x.avatar||"💬").slice(0,500);
 await q("update users set bio=$1,status=$2,avatar=$3,updated_at=now() where lower(username)=lower($4)",[bio,status,avatar,sess.username]);
 const u=await getUser(sess.username);wsSend(socket,{type:"profile",me:{username:u.username,bio:u.bio,status:u.status,avatar:u.avatar&&u.avatar.includes("/")?await signedUrl(u.avatar):u.avatar}});await sendDirectory();
}

async function handle(socket,raw){
 let x;try{x=JSON.parse(raw)}catch{return}
 if(x.action==="register"){
   const n=cleanName(x.nickname),p=x.password;
   if(!n||!passOk(p))return wsSend(socket,{type:"error",code:"REGISTER",message:"Usuário 3–24 caracteres e senha 4–72."});
   if(await getUser(n))return wsSend(socket,{type:"error",code:"REGISTER",message:"Esse usuário já existe."});
   const h=hashPassword(p);await q("insert into users(username,salt,password_hash,created_at,updated_at) values($1,$2,$3,now(),now())",[n,h.salt,h.hash]);return wsSend(socket,{type:"registered",nickname:n});
 }
 if(x.action==="login"){
   const n=cleanName(x.nickname),r=n?await getUser(n):null;
   if(!r||!passOk(x.password)||!verifyPassword(x.password,r))return wsSend(socket,{type:"error",code:"LOGIN",message:"Usuário ou senha incorretos."});
   if(findSession(r.username))return wsSend(socket,{type:"error",code:"LOGIN",message:"Esse usuário já está conectado."});
   const sess={username:r.username,token:token()};sessions.set(socket,sess);
   wsSend(socket,{type:"welcome",self:r.username,sessionToken:sess.token,me:{username:r.username,bio:r.bio,status:r.status,avatar:r.avatar&&r.avatar.includes("/")?await signedUrl(r.avatar):r.avatar},users:(await getPublicUsers()).map(u=>u.username),online:await getOnline(),contacts:await getContacts(r.username),general:await history("general"),share:shareFor(r.username)});
   broadcast({type:"presence",online:await getOnline()});await sendDirectory();return;
 }
 const sess=sessionUser(socket);if(!sess)return;
 if(x.action==="typing"){const target=x.scope==="private"?cleanName(x.to):null;if(target){const t=findSession(target);if(t)wsSend(t,{type:"typing",from:sess.username,scope:"private",active:!!x.active})}else broadcast({type:"typing",from:sess.username,scope:"general",active:!!x.active},socket);return}
 if(x.action==="openGeneral")return wsSend(socket,{type:"generalHistory",messages:await history("general")});
 if(x.action==="openPrivate"){const u=await getUser(cleanName(x.to)||"");if(u)wsSend(socket,{type:"privateHistory",with:u.username,messages:await history(convo(sess.username,u.username))});return}
 if(x.action==="markRead"){await q("insert into reads(message_id,username,read_at) values($1,$2,now()) on conflict(message_id,username) do update set read_at=excluded.read_at",[x.id,sess.username]);return}
 if(x.action==="profile")return profileUpdate(sess,x,socket);
 if(x.action==="general"||x.action==="private"){
   if(!canMessage(socket))return wsSend(socket,{type:"error",code:"MESSAGE",message:"Muitas mensagens. Aguarde alguns segundos."});
   const text=typeof x.text==="string"?x.text.trim():"";if(!text||text.length>2000)return;
   if(x.action==="general"){const m={type:"message",id:crypto.randomUUID(),from:sess.username,to:null,text,replyTo:x.replyTo||null,kind:"text",timestamp:now()};await q("insert into messages(id,conversation,sender,recipient,text,reply_to,kind,created_at,updated_at) values($1,'general',$2,$3,$4,$5,'text',$6,$6)",[m.id,m.from,null,m.text,m.replyTo,m.timestamp]);return broadcast(m)}
   const u=await getUser(cleanName(x.to)||"");if(!u||u.username.toLowerCase()===sess.username.toLowerCase())return;
   const m={type:"private",id:crypto.randomUUID(),from:sess.username,to:u.username,text,replyTo:x.replyTo||null,kind:"text",timestamp:now()};await q("insert into messages(id,conversation,sender,recipient,text,reply_to,kind,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'text',$7,$7)",[m.id,convo(sess.username,u.username),m.from,m.to,m.text,m.replyTo,m.timestamp]);wsSend(socket,m);const t=findSession(u.username);if(t)wsSend(t,m);return;
 }
 if(x.action==="shareStart"){
   const scope=x.scope==="private"?"private":"general",target=scope==="private"?cleanName(x.to):null;
   if(scope==="private"&&(!target||!findSession(target)))return wsSend(socket,{type:"shareError",message:"O usuário precisa estar online."});
   if(activeShare.owner)return wsSend(socket,{type:"shareError",message:`${activeShare.owner} já está compartilhando. Apenas uma transmissão pode ficar ativa.`});
   Object.assign(activeShare,{owner:sess.username,scope,target,startedAt:now()});
   for(const[s]of sessions){const info=shareFor(sessionUser(s).username);wsSend(s,{type:"shareAvailable",share:info,owner:activeShare.owner})}return;
 }
 if(x.action==="shareRequest"){
   const owner=cleanName(x.owner);if(!activeShare.owner||activeShare.owner.toLowerCase()!==owner?.toLowerCase())return wsSend(socket,{type:"shareError",message:"Transmissão indisponível."});
   if(activeShare.scope==="private"&&activeShare.target.toLowerCase()!==sess.username.toLowerCase())return;
   const dest=findSession(owner);if(dest)wsSend(dest,{type:"shareRequest",from:sess.username,to:owner});return;
 }
 if(["shareOffer","shareAnswer","shareIce"].includes(x.action)){
   const target=cleanName(x.to),dest=target&&findSession(target);if(!dest)return;
   const out={type:x.action,from:sess.username,to:target};if(x.offer)out.offer=x.offer;if(x.answer)out.answer=x.answer;if(x.candidate)out.candidate=x.candidate;wsSend(dest,out);return;
 }
 if(x.action==="shareStop"&&activeShare.owner?.toLowerCase()===sess.username.toLowerCase()){
   const owner=activeShare.owner;Object.assign(activeShare,{owner:null,scope:null,target:null,startedAt:null});broadcast({type:"shareUnavailable",owner});broadcast({type:"shareStopped",from:owner});return;
 }
}

function parseFrames(socket,b){
 let o=0;while(b.length-o>=2){const b1=b[o],b2=b[o+1],op=b1&15,mask=!!(b2&128);let n=b2&127,h=2;
  if(n===126){if(b.length-o<4)break;n=b.readUInt16BE(o+2);h=4}else if(n===127)throw Error("frame too large");
  const total=h+(mask?4:0)+n;if(n>65535||b.length-o<total)break;const st=o+h,d=Buffer.from(b.subarray(st+(mask?4:0),st+(mask?4:0)+n));
  if(mask){const m=b.subarray(st,st+4);for(let i=0;i<d.length;i++)d[i]^=m[i%4]}o+=total;
  if(op===8){socket.end();continue}if(op===9){try{socket.write(Buffer.from([138,0]))}catch{}continue}if(op===1)handle(socket,d.toString()).catch(e=>console.error("WS",e))
 }return b.subarray(o);
}
function close(socket){
 const s=sessions.get(socket);sessions.delete(socket);clients.delete(socket);rate.delete(socket);
 if(s&&activeShare.owner?.toLowerCase()===s.username.toLowerCase()){const owner=activeShare.owner;Object.assign(activeShare,{owner:null,scope:null,target:null,startedAt:null});broadcast({type:"shareUnavailable",owner})}
 broadcast({type:"presence",online:[...sessions.values()].map(v=>v.username)});sendDirectory().catch(console.error);
}
const requestHandler=async(req,res)=>{
 try{
  let u=decodeURIComponent(req.url.split("?")[0]);if(u==="/")u="/index.html";
  if(u==="/api/health")return json(res,200,{ok:true,service:"pikachu",online:sessions.size});
  if(req.method==="POST"&&(u==="/api/audio"||u==="/api/avatar"||u==="/api/image")){
    const sess=authHeader(req);if(!sess)return json(res,401,{ok:false,message:"Sessão inválida."});
    if(!canMessage(Array.from(sessions).find(s=>sessions.get(s)===sess)))return json(res,429,{ok:false,message:"Muitas requisições."});
    const b=await body(req,u==="/api/audio"?5_000_000:u==="/api/avatar"?2_000_000:8_000_000),ct=getHeader(req,"content-type");
    if(u==="/api/avatar"&&!/^image\/(png|jpeg|webp|gif)$/.test(ct))return json(res,400,{ok:false,message:"Formato de foto inválido."});
    if(u==="/api/image"&&!/^image\/(png|jpeg|webp|gif)$/.test(ct))return json(res,400,{ok:false,message:"Formato de imagem inválido."});
    if(u==="/api/audio"&&!/^audio\/(webm|ogg|mp4|wav)$/.test(ct))return json(res,400,{ok:false,message:"Formato de áudio inválido."});
    const ext=ct.includes("png")?".png":ct.includes("webp")?".webp":ct.includes("gif")?".gif":ct.includes("ogg")?".ogg":ct.includes("wav")?".wav":ct.includes("mp4")?".m4a":".webm";
    const folder=u==="/api/avatar"?"avatars":u==="/api/image"?"images":"audio",storagePath=`${folder}/${crypto.randomUUID()}${ext}`;
    const up=await sb.storage.from(STORAGE_BUCKET).upload(storagePath,b,{contentType:ct,upsert:false});if(up.error)return json(res,500,{ok:false,message:"Falha ao salvar arquivo."});
    if(u==="/api/avatar"){await q("update users set avatar=$1,updated_at=now() where lower(username)=lower($2)",[storagePath,sess.username]);await sendDirectory();return json(res,200,{ok:true,path:storagePath,url:await signedUrl(storagePath)})}
    const target=u==="/api/image"||u==="/api/audio"? (getHeader(req,"x-pikachu-scope")==="private"?cleanName(getHeader(req,"x-pikachu-to")):null):null;
    if(target&&!await getUser(target))return json(res,400,{ok:false,message:"Destinatário inválido."});
    const kind=u==="/api/image"?"image":"audio",id=crypto.randomUUID(),c=target?convo(sess.username,target):"general",duration=Number(getHeader(req,"x-pikachu-duration")||0);
    const m={type:kind,id,from:sess.username,to:target,text:kind==="image"?"[Imagem]":"[Áudio]",url:await signedUrl(storagePath),duration,timestamp:now(),kind};
    await q("insert into messages(id,conversation,sender,recipient,text,kind,media_path,duration,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",[id,c,m.from,m.to,m.text,kind,storagePath,duration,m.timestamp]);
    if(target){wsSend(findSession(target),m);wsSend(findSession(sess.username),m)}else broadcast(m);
    return json(res,200,{ok:true,url:m.url,id});
  }
  const file=path.join(PUBLIC,u);if(!file.startsWith(PUBLIC))return res.writeHead(403).end();
  fs.readFile(file,(e,d)=>{if(e)return res.writeHead(404).end("Not found");const type=MIME[path.extname(file)]||"application/octet-stream";res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});res.end(d)});
 }catch(e){console.error("HTTP",e);if(!res.headersSent)json(res,500,{ok:false,message:"Erro interno."});}
};
const server=http.createServer(requestHandler);
server.on("upgrade",(req,socket)=>{
 const k=req.headers["sec-websocket-key"];if(!k)return socket.end();
 const a=crypto.createHash("sha1").update(k+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
 socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${a}\r\n\r\n`);
 clients.add(socket);let b=Buffer.alloc(0);socket.on("data",c=>{try{b=parseFrames(socket,Buffer.concat([b,c]))}catch(e){socket.end()}});socket.on("close",()=>close(socket));socket.on("error",()=>close(socket));
});
server.listen(PORT,HOST,()=>console.log(`Pikachu listening on ${HOST}:${PORT}`));
