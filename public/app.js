let ws=null,currentUser="",me={},current="general",replyTo=null,timer,contacts=[],mediaRecorder=null,audioChunks=[],recordStarted=0,recordTimer=null;
let activeShare=null,sharePeers=new Map(),viewerPeer=null,viewerOwner=null,screenStream=null,shareInitiator=false,pendingViewerIce=[];
const $=id=>document.getElementById(id);
let reconnectTimer=null,reconnectAttempt=0,intentionalClose=false,historyCursor=null,hasMoreHistory=false;
let pendingAudioBlob=null,pendingAudioDuration=0;
const pendingMessages=new Map();
async function api(url,data){
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data||{})});
 const result=await response.json();if(!response.ok)throw new Error(result.message||"Serviço indisponível.");return result;
}
function cleanupMedia(){cancelRecording();cancelAudioPreview();if(shareInitiator)stopOwnerShare(false);stopReceivingShare();activeShare=null;renderShareState()}
function showLogin(){intentionalClose=true;clearTimeout(reconnectTimer);cleanupMedia();ws?.close();currentUser="";pendingMessages.clear();$("chatApp").classList.add("hidden");$("loginView").classList.remove("hidden")}
async function logout(){
 try{await api("/api/logout");showLogin()}catch(e){alert(e.message)}
}
function updateHistory(m){
 hasMoreHistory=!!m.hasMore;historyCursor=m.nextCursor||null;$("loadHistory").classList.toggle("hidden",!hasMoreHistory);
 if(m.prepend){const old=[...$("messages").children];$("messages").replaceChildren();(m.messages||[]).forEach(renderOne);old.forEach(el=>{if(!el.dataset.mid||!document.querySelector(`[data-mid="${CSS.escape(el.dataset.mid)}"]`))$("messages").appendChild(el)})}
 else renderMessages(m.messages||[]);
}
function loadHistory(){if(!hasMoreHistory||ws?.readyState!==WebSocket.OPEN)return;ws.send(JSON.stringify({action:current==="general"?"openGeneral":"openPrivate",to:current.slice(8),cursor:historyCursor}))}


function auth(text,ok=false){$("authMessage").textContent=text;$("authMessage").style.color=ok?"#77c68e":"#ff8b8b"}
function tab(n){$("tabLogin").classList.toggle("active",n===1);$("tabRegister").classList.toggle("active",n===2);$("loginPanel").classList.toggle("hidden",n!==1);$("registerPanel").classList.toggle("hidden",n!==2);$("authMessage").textContent=""}
function connect(){
 clearTimeout(reconnectTimer);intentionalClose=false;
 const socket=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}`);ws=socket;
 socket.onerror=()=>auth("Falha ao conectar ao servidor.");
 socket.onclose=async e=>{
  if(ws!==socket||intentionalClose)return;
  cleanupMedia();$("onlineStatus").textContent="● OFFLINE";
  if(e.code===4401){showLogin();auth("Sessão expirada. Entre novamente.");return}
  try{const r=await fetch("/api/session");if(r.status===401){showLogin();return}}catch{}
  if(intentionalClose||ws!==socket)return;
  const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5))+Math.random()*500;
  reconnectTimer=setTimeout(connect,delay);
 };
 socket.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(err){console.error(err)}};
}
async function login(){
 const n=$("loginUser").value.trim(),p=$("loginPass").value;if(!n||!p)return auth("Preencha usuário e senha.");
 try{await api("/api/login",{nickname:n,password:p});$("loginPass").value="";intentionalClose=true;ws?.close();connect()}catch(e){auth(e.message)}
}
async function register(){
 const n=$("registerUser").value.trim(),p=$("registerPass").value,p2=$("registerPass2").value;
 if(p!==p2)return auth("As senhas não conferem.");
 try{const out=await api("/api/register",{nickname:n,password:p});tab(1);$("loginUser").value=n;$("registerPass").value="";$("registerPass2").value="";auth(out.message,true)}catch(e){auth(e.message)}
}

function handle(m){
 if(m.type==="error"){if(m.id)pendingMessages.delete(m.id);if(shareInitiator&&m.status)stopOwnerShare(true);alert(m.message);return}
 if(m.type==="welcome"){
   reconnectAttempt=0;currentUser=m.self;me=m.me||{username:currentUser};contacts=m.contacts||[];activeShare=m.share||null;localStorage.setItem("pikachu.user",currentUser);
   $("loginView").classList.add("hidden");$("chatApp").classList.remove("hidden");
   renderOnline(m.online||[]);renderContacts(contacts);renderShareState();
   const previous=current;openGeneralWithMessages([]);updateHistory({messages:m.general||[],hasMore:m.hasMore,nextCursor:m.nextCursor});
   if(previous!=="general")openPrivate(previous.slice(8));
   for(const pending of pendingMessages.values())ws.send(JSON.stringify(pending));return;
 }
 if(m.type==="directory"){contacts=m.contacts||contacts;renderContacts(contacts);if("share"in m){const viewing=activeShare?.viewing;activeShare=m.share;if(activeShare)activeShare.viewing=viewing;renderShareState()}return}
 if(m.type==="presence"){renderOnline(m.online||[]);return}
 if(m.type==="generalHistory"){if(current==="general")updateHistory(m);return}
 if(m.type==="privateHistory"){if(current===privateKey(m.with))updateHistory(m);return}
 if(["message","private","image","audio"].includes(m.type)){
   pendingMessages.delete(m.id);
   const peer=m.from===currentUser?m.to:m.from;
   const visible=m.to?current===privateKey(peer):current==="general";
   if(visible)renderOne(m);
   if(m.to){updateUnread(m);if(m.from!==currentUser)notify(m)}return;
 }
 if(m.type==="sharePeerLeft"){stopOwnerPeer(m.from);return}
 if(m.type==="shareAvailable"){activeShare=m.share||null;renderShareState();return}
 if(m.type==="shareUnavailable"){activeShare=null;stopReceivingShare();renderShareState();return}
 if(m.type==="shareRequest"){handleShareRequest(m);return}
 if(m.type==="shareOffer"){receiveShareOffer(m);return}
 if(m.type==="shareAnswer"){receiveShareAnswer(m);return}
 if(m.type==="shareIce"){receiveShareIce(m);return}
 if(m.type==="shareStopped"){if(shareInitiator)stopOwnerShare(false);activeShare=null;stopReceivingShare();renderShareState();return}
 if(m.type==="shareError"){if(shareInitiator)stopOwnerShare(false);alert(m.message);return}
 if(m.type==="typing"){
   if(m.from===currentUser)return;
   const expected=m.scope==="general"?"general":privateKey(m.from);
   $("typingIndicator").textContent=(current===expected&&m.active)?m.from+" está digitando...":"";
   return;
 }
 if(m.type==="read"){const el=document.querySelector(`[data-mid="${CSS.escape(m.id)}"]`);if(el&&m.username!==currentUser&&el.classList.contains("mine")){el.dataset.read="true";el.title="Lida por "+m.username}return;}
 if(m.type==="profile"){me=m.me||me;$("profileMessage").textContent="Perfil salvo.";return}
}
function privateKey(name){return "private:"+String(name).toLowerCase()}
function renderOnline(list){$("onlineStatus").textContent="● ONLINE";$("onlineCount").textContent=list.length}
function avatarMarkup(src,fallback="💬"){
  if(src&&(String(src).startsWith("https://")||String(src).startsWith("/api/avatars/")))return `<img class="avatar-img" src="${esc(src)}" alt="">`;
  return esc(fallback);
}
function renderContacts(list){
 const box=$("privateList");box.replaceChildren();
 for(const c of list){
   const b=document.createElement("button");b.type="button";b.className="conversation-item";b.dataset.user=c.username;
   b.innerHTML=`<span class="conversation-avatar">${avatarMarkup(c.avatar)}</span><span class="conversation-copy"><b>${esc(c.username)}</b><small>${esc(c.last?.text?.slice(0,28)||c.status||"conversa privada")}</small></span>${c.unread?`<span class="unread">${c.unread}</span>`:""}`;
   b.onclick=()=>openPrivate(c.username,b);b.classList.toggle("active",current===privateKey(c.username));box.appendChild(b);
 }
}
function markActive(el){document.querySelectorAll(".conversation-item").forEach(x=>x.classList.remove("active"));el?.classList.add("active")}
function openGeneralWithMessages(list){current="general";markActive($("generalButton"));$("chatIcon").textContent="⚡";$("chatTitle").textContent="canal-geral";$("chatSubtitle").textContent="Todos os agentes";$("typingIndicator").textContent="";renderMessages(list)}
function openGeneral(){
 if(ws?.readyState!==WebSocket.OPEN)return;
 current="general";markActive($("generalButton"));$("chatIcon").textContent="⚡";$("chatTitle").textContent="canal-geral";$("chatSubtitle").textContent="Todos os agentes";$("typingIndicator").textContent="";ws.send(JSON.stringify({action:"openGeneral"}));$("messageInput").focus()
}
function openPrivate(name,button){
 if(ws?.readyState!==WebSocket.OPEN)return;
 current=privateKey(name);markActive(button);$("chatIcon").textContent="●";$("chatTitle").textContent=name;$("chatSubtitle").textContent="conversa privada";$("typingIndicator").textContent="";$("messages").replaceChildren();
 const c=contacts.find(x=>x.username.toLowerCase()===name.toLowerCase());if(c)c.unread=0;renderContacts(contacts);
 ws.send(JSON.stringify({action:"openPrivate",to:name}));$("messageInput").focus()
}

async function toggleRecording(){
  let recordingStream=null;
  if(mediaRecorder){stopRecording();return}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert("Seu navegador não suporta gravação de áudio.");return}
  if(!window.isSecureContext){alert("Por segurança, o microfone exige localhost ou HTTPS.");return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordingStream=stream;
    let mime="audio/webm";
    if(MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))mime="audio/webm;codecs=opus";
    else if(MediaRecorder.isTypeSupported("audio/ogg;codecs=opus"))mime="audio/ogg;codecs=opus";
    else if(MediaRecorder.isTypeSupported("audio/mp4"))mime="audio/mp4";
    mediaRecorder=new MediaRecorder(stream,{mimeType:mime});
    audioChunks=[];recordStarted=Date.now();$("recordingState").textContent="Gravando...";
    mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      clearInterval(recordTimer);$("recordingBar").classList.add("hidden");
      const used=mediaRecorder?.mimeType||mime;
      const blob=new Blob(audioChunks,{type:used});
      const seconds=Math.min(180,(Date.now()-recordStarted)/1000);
      stream.getTracks().forEach(t=>t.stop());
      mediaRecorder=null;audioChunks=[];
      $("recordingTime").textContent="00:00";
      if(blob.size>5_000_000){alert("O áudio ficou grande demais. Limite: 5 MB.");return}
      pendingAudioBlob=blob;pendingAudioDuration=seconds;
      $("audioPreview").src=URL.createObjectURL(blob);
      $("audioPreviewTime").textContent=formatDuration(seconds);
      $("audioPreviewBar").classList.remove("hidden");
    };
    mediaRecorder.start(250);
    $("recordingBar").classList.remove("hidden");
    recordTimer=setInterval(()=>{
      const sec=Math.floor((Date.now()-recordStarted)/1000);
      $("recordingTime").textContent=formatDuration(sec);
      if(sec>=180)stopRecording();
    },250);
  }catch(e){
    recordingStream?.getTracks().forEach(t=>t.stop());
    alert(e?.name==="NotAllowedError"?"Permissão do microfone negada. Libere o microfone no navegador.":"Não foi possível acessar o microfone.");
  }
}
function stopRecording(){if(mediaRecorder&&mediaRecorder.state!=="inactive")mediaRecorder.stop()}
function cancelRecording(){
  if(mediaRecorder){
    const r=mediaRecorder;mediaRecorder=null;
    try{r.onstop=null;r.stop()}catch{}
    r.stream?.getTracks()?.forEach(t=>t.stop());
  }
  audioChunks=[];clearInterval(recordTimer);$("recordingBar").classList.add("hidden");$("recordingTime").textContent="00:00";
}
function cancelAudioPreview(){
  if($("audioPreview").src.startsWith("blob:"))URL.revokeObjectURL($("audioPreview").src);
  pendingAudioBlob=null;pendingAudioDuration=0;
  $("audioPreview").pause();$("audioPreview").removeAttribute("src");$("audioPreview").load();
  $("audioPreviewBar").classList.add("hidden");
}
async function sendPendingAudio(){
  if(!pendingAudioBlob)return;
  if(await uploadAudio(pendingAudioBlob,pendingAudioDuration))cancelAudioPreview();
}
async function uploadAudio(blob,duration){
  if(!ws||ws.readyState!==WebSocket.OPEN)return alert("O chat está desconectado.");
  const headers={"Content-Type":blob.type||"audio/webm","X-Pikachu-Scope":current==="general"?"general":"private","X-Pikachu-Duration":String(duration)};
  if(current!=="general")headers["X-Pikachu-To"]=current.slice(8);
  if(replyTo)headers["X-Pikachu-Reply"]=replyTo;
  try{
    const res=await fetch("/api/audio",{method:"POST",headers,body:blob});
    const out=await res.json();if(!res.ok||!out.ok)throw new Error(out.message||"Falha ao enviar áudio");
    cancelReply();return true;
  }catch(e){alert("Não foi possível enviar o áudio: "+e.message);return false}
}
function addAudio(m){
 const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
 const d=document.createElement("div");d.className="msg"+(m.from===currentUser?" mine":"");d.dataset.mid=m.id;
 const meta=document.createElement("div");meta.className="meta";meta.textContent=`[${new Date(m.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}] ${m.from}`;
 const wrap=document.createElement("div");wrap.className="bubble audio-message";
 const audio=document.createElement("audio");
 audio.controls=true;audio.preload="metadata";
 audio.src=new URL(m.url,location.origin).href;
 audio.addEventListener("error",()=>{dur.textContent="Áudio indisponível"});
 audio.addEventListener("loadedmetadata",()=>{if(!m.duration||Number(m.duration)<=0)dur.textContent=formatDuration(audio.duration)});
 const dur=document.createElement("span");dur.className="audio-duration";dur.textContent=formatDuration(m.duration);
 wrap.append(audio,dur);d.append(meta,wrap);$("messages").appendChild(d);bottom();
}
function formatDuration(sec){sec=Math.round(Number(sec)||0);return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function renderMessages(list){
 $("messages").replaceChildren();
 if(!list.length){$("messages").innerHTML='<div class="empty"><div><b>Nenhuma mensagem ainda</b>Comece a conversa.</div></div>';return}
 list.forEach(renderOne);bottom()
}
function renderOne(m){
 if(document.querySelector(`[data-mid="${CSS.escape(m.id)}"]`))return;
 if(m.kind==="image"||m.type==="image")addImageMessage(m);else if(m.kind==="audio"||m.type==="audio")addAudio(m);else addMessage(m);
 const el=document.querySelector(`[data-mid="${CSS.escape(m.id)}"]`);
 if(el&&m.from===currentUser&&m.readBy?.some(x=>x!==currentUser)){el.dataset.read="true";el.title="Lida"}
 if(m.from!==currentUser&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"markRead",id:m.id}));
}
function addImageMessage(m){
 const wrap=document.createElement("div");wrap.className="msg "+(m.from===currentUser?"mine":"theirs");wrap.dataset.mid=m.id||"";const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
 const b=document.createElement("div");b.className="bubble image-bubble";
 const im=document.createElement("img");im.src=m.url;im.alt="Imagem enviada";im.loading="lazy";im.onclick=()=>window.open(m.url,"_blank");
 im.onerror=()=>{b.textContent="Não foi possível carregar a imagem."};
 b.appendChild(im);wrap.appendChild(b);$("messages").appendChild(wrap);$("messages").scrollTop=$("messages").scrollHeight;
}
async function uploadImage(file){
 try{
 if(!file||!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){alert("Selecione uma imagem PNG, JPG, WEBP ou GIF.");return}
 if(file.size>8*1024*1024){alert("A imagem deve ter no máximo 8 MB.");return}
 const privateChat=current!=="general",to=privateChat?current.slice(8):"";
 const r=await fetch("/api/image",{method:"POST",headers:{"Content-Type":file.type,"x-pikachu-scope":privateChat?"private":"general","x-pikachu-to":to},body:file});
 const d=await r.json().catch(()=>({ok:false,message:"Falha ao enviar imagem."}));
 if(!r.ok||!d.ok)alert(d.message||"Falha ao enviar imagem.");
 }catch(e){alert("Falha ao enviar imagem: "+e.message)}
}
function addMessage(m){
 const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
 const d=document.createElement("div");d.className="msg"+(m.from===currentUser?" mine":"");d.dataset.mid=m.id;
 const meta=document.createElement("div");meta.className="meta";meta.textContent=`[${new Date(m.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}] ${m.from}`;
 const b=document.createElement("div");b.className="bubble";b.textContent=m.deleted?"Mensagem excluída":m.text;if(!m.deleted)b.onclick=()=>reply(m);
 d.append(meta,b);if(m.edited&&!m.deleted){const e=document.createElement("div");e.className="edited";e.textContent="editada";d.append(e)}
 $("messages").appendChild(d);bottom()
}
function bottom(){$("messages").scrollTop=$("messages").scrollHeight}
function reply(m){replyTo=m.id;$("replyPreview").textContent=`Respondendo a ${m.from}: ${m.text.slice(0,90)}`;$("replyBar").classList.remove("hidden");$("messageInput").focus()}
function cancelReply(){replyTo=null;$("replyBar").classList.add("hidden")}
function send(){
 const text=$("messageInput").value.trim();if(!text||!ws||ws.readyState!==WebSocket.OPEN)return;
 const d=current==="general"?{action:"general",text}:{action:"private",to:current.replace(/^private:/,""),text};d.id=crypto.randomUUID();if(replyTo)d.replyTo=replyTo;pendingMessages.set(d.id,d);
 ws.send(JSON.stringify(d));$("messageInput").value="";cancelReply();sendTyping(false);$("messageInput").focus()
}
$("messageForm").onsubmit=e=>{e.preventDefault();send()}
$("messageInput").oninput=()=>{sendTyping($("messageInput").value.length>0);clearTimeout(timer);timer=setTimeout(()=>sendTyping(false),900)}
function sendTyping(active){if(!ws||ws.readyState!==WebSocket.OPEN)return;const d={action:"typing",active,scope:current==="general"?"general":"private"};if(current!=="general")d.to=current.replace(/^private:/,"");ws.send(JSON.stringify(d))}
function updateUnread(m){if(m.from===currentUser)return;const peer=m.from;const c=contacts.find(x=>x.username.toLowerCase()===peer.toLowerCase());if(c&&current!==privateKey(peer))c.unread=(c.unread||0)+1;renderContacts(contacts)}
function notify(m){if(m.from===currentUser||!document.hidden||!("Notification"in window))return;if(Notification.permission==="granted")new Notification("⚡ "+m.from,{body:m.text})}

function explainShareError(e){
  const name=e?.name||"Erro";
  if(name==="NotAllowedError") return "O compartilhamento foi cancelado ou o navegador bloqueou a permissão.";
  if(name==="NotFoundError") return "Nenhuma tela ou janela disponível para compartilhar.";
  if(name==="NotReadableError") return "O sistema não conseguiu capturar essa tela/janela. Tente escolher outra.";
  if(name==="SecurityError") return "O navegador bloqueou a captura por segurança. Use localhost ou HTTPS.";
  if(name==="InvalidStateError") return "A captura precisa ser iniciada a partir de um clique direto no botão.";
  if(name==="AbortError") return "Compartilhamento cancelado.";
  if(name==="TypeError") return "O navegador não conseguiu iniciar a captura neste endereço.";
  return `Não foi possível iniciar o compartilhamento (${name}).`;
}
function makePeer(target,isOwner){
 const pc=new RTCPeerConnection({
  iceServers:[
   {urls:"stun:stun.l.google.com:19302"},
   {urls:"stun:stun1.l.google.com:19302"}
  ]
 });
 pc._pending=[];
 pc.onicecandidate=e=>{
  if(e.candidate&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"shareIce",to:target,candidate:e.candidate}))
 };
 pc.onconnectionstatechange=()=>{
  if(isOwner&&pc.connectionState==="connected")$("screenStatus").textContent="Sua tela está sendo exibida";
  if(!isOwner&&pc.connectionState==="connected")$("screenStatus").textContent=target+" está compartilhando a tela";
  if(pc.connectionState==="failed"){if(isOwner)stopOwnerPeer(target);else stopReceivingShare()}
 };
 if(!isOwner){
  pc.ontrack=e=>{
   const v=$("screenVideo");v.srcObject=e.streams[0]||new MediaStream([e.track]);v.muted=true;v.autoplay=true;v.playsInline=true;
   v.onloadedmetadata=()=>v.play().catch(err=>console.warn("screen play",err));
   $("screenStatus").textContent=target+" está compartilhando a tela";
   $("screenOverlay").classList.remove("hidden");
  };
 }
 return pc;
}
async function startShareFlow(){
 if(!window.isSecureContext){alert("Use https:// no computador da rede. localhost é a exceção.");return}
 if(!navigator.mediaDevices?.getDisplayMedia){alert("Seu navegador não permite compartilhamento de tela neste endereço.");return}
 if(ws?.readyState!==WebSocket.OPEN)return;
 if(activeShare){alert("Já existe uma transmissão ativa. Apenas uma pessoa pode compartilhar por vez.");return}
 const scope=current==="general"?"general":"private";
 const target=scope==="private"?current.slice(8):null;
 try{
  screenStream=await navigator.mediaDevices.getDisplayMedia({
   video:{width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},frameRate:{ideal:30,max:30}},
   audio:false
  });
  const track=screenStream.getVideoTracks()[0];
  if(track)track.contentHint="detail";
  shareInitiator=true;sharePeers.clear();
  activeShare={owner:currentUser,scope,target,startedAt:new Date().toISOString(),self:true};
  ws.send(JSON.stringify({action:"shareStart",scope,to:target||undefined}));
  $("sharePanel").classList.add("hidden");
  $("screenVideo").srcObject=screenStream;$("screenStatus").textContent="Sua tela está disponível — aguardando acesso";
  $("screenOverlay").classList.remove("hidden");
  track.onended=()=>stopOwnerShare(true);
 }catch(e){
  if(e?.name!=="AbortError")alert(explainShareError(e));
  screenStream?.getTracks().forEach(t=>t.stop());screenStream=null;
 }
}
async function configureSender(peer){
 for(const sender of peer.getSenders()){
  if(sender.track?.kind!=="video")continue;
  try{
   const p=sender.getParameters();p.encodings=p.encodings||[{}];
   p.encodings[0].maxBitrate=8_000_000;p.encodings[0].maxFramerate=30;
   p.degradationPreference="maintain-resolution";
   await sender.setParameters(p);
  }catch{}
 }
}
async function handleShareRequest(m){
 if(!screenStream)return;
 stopOwnerPeer(m.from);
 const peer=makePeer(m.from,true);sharePeers.set(m.from.toLowerCase(),peer);
 screenStream.getVideoTracks().forEach(t=>peer.addTrack(t,screenStream));
 await configureSender(peer);
 try{const offer=await peer.createOffer();await peer.setLocalDescription(offer);ws.send(JSON.stringify({action:"shareOffer",to:m.from,offer:peer.localDescription}))}catch{stopOwnerPeer(m.from)}
}
function stopOwnerPeer(name){
 const key=String(name).toLowerCase(),peer=sharePeers.get(key);if(peer){try{peer.close()}catch{}sharePeers.delete(key)}
}
async function receiveShareOffer(m){
  if(!activeShare?.viewing||m.from!==viewerOwner)return;
  if(viewerPeer)try{viewerPeer.close()}catch{}
  viewerOwner=m.from;
  const queuedIce=pendingViewerIce.splice(0);viewerPeer=makePeer(m.from,false);
  try{
    await viewerPeer.setRemoteDescription(new RTCSessionDescription(m.offer));
    if(queuedIce.length||viewerPeer._pending.length){
      const q=[...queuedIce,...viewerPeer._pending.splice(0)];
      for(const c of q)try{await viewerPeer.addIceCandidate(c)}catch{}
    }
    const answer=await viewerPeer.createAnswer();
    await viewerPeer.setLocalDescription(answer);
    ws.send(JSON.stringify({action:"shareAnswer",to:m.from,answer:viewerPeer.localDescription}));
    if(activeShare){activeShare.viewing=true;renderShareState()}
  }catch(e){
    console.error("receiveShareOffer",e);
    stopReceivingShare();
    alert("Não foi possível abrir a transmissão. Tente novamente.");
  }
}
async function receiveShareAnswer(m){
  const peer=sharePeers.get(String(m.from).toLowerCase());if(!peer)return;
  try{
    await peer.setRemoteDescription(new RTCSessionDescription(m.answer));
    const q=peer._pending||[];peer._pending=[];
    for(const c of q)try{await peer.addIceCandidate(c)}catch{}
  }catch(e){console.warn("receiveShareAnswer",e)}
}
async function receiveShareIce(m){
  if(!m.candidate||(!shareInitiator&&m.from!==viewerOwner))return;
  if(shareInitiator){
    const peer=sharePeers.get(String(m.from).toLowerCase());
    if(!peer)return;
    if(peer.remoteDescription?.type){
      try{await peer.addIceCandidate(m.candidate)}catch{}
    }else{
      peer._pending=peer._pending||[];
      peer._pending.push(m.candidate);
    }
  }else{
    if(!viewerPeer){
      pendingViewerIce.push(m.candidate);
      return;
    }
    if(viewerPeer.remoteDescription?.type){
      try{await viewerPeer.addIceCandidate(m.candidate)}catch{}
    }else{
      viewerPeer._pending=viewerPeer._pending||[];
      viewerPeer._pending.push(m.candidate);
    }
  }
}
function requestShare(owner){
 if(!activeShare||activeShare.owner.toLowerCase()!==owner.toLowerCase())return;
 if(ws?.readyState!==WebSocket.OPEN)return;
 viewerOwner=owner;activeShare.viewing=true;renderShareState();$("screenStatus").textContent="Conectando à tela de "+owner+"...";
 ws.send(JSON.stringify({action:"shareRequest",owner}));
}
function stopOwnerShare(notify=true){
 for(const k of [...sharePeers.keys()])stopOwnerPeer(k);
 if(screenStream)screenStream.getTracks().forEach(t=>t.stop());screenStream=null;
 if(notify&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"shareStop"}));
 $("screenVideo").srcObject=null;$("screenOverlay").classList.add("hidden");activeShare=null;shareInitiator=false;renderShareState()
}
function stopReceivingShare(){
 if(viewerOwner&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"shareLeave"}));
 if(activeShare)activeShare.viewing=false;
 if(viewerPeer){try{viewerPeer.close()}catch{};viewerPeer=null}
 pendingViewerIce=[];
 $("screenVideo").srcObject=null;$("screenOverlay").classList.add("hidden");viewerOwner=null;renderShareState()
}
function renderShareState(){
 const box=$("sharedScreens");if(!box)return;box.replaceChildren();
 if(!activeShare){const n=document.createElement("div");n.className="shared-none";n.textContent="Nenhuma tela compartilhada.";box.appendChild(n);return}
 const card=document.createElement("div");card.className="shared-card";
 const title=document.createElement("b");title.innerHTML=`<span class="shared-live"></span>${esc(activeShare.owner)}`;
 const sub=document.createElement("small");sub.textContent=activeShare.self?"Você está compartilhando":"Tela disponível";
 const row=document.createElement("div");row.className="shared-actions";
 const btn=document.createElement("button");btn.type="button";btn.className="primary-mini";
 if(activeShare.self){btn.textContent="Parar";btn.onclick=()=>stopOwnerShare(true)}
 else{btn.textContent=activeShare.viewing?"Abrindo...":"Ver tela";btn.disabled=!!activeShare.viewing;btn.onclick=()=>requestShare(activeShare.owner)}
 row.appendChild(btn);card.append(title,sub,row);box.appendChild(card)
}
function toggleSharePanel(){$("sharePanel").classList.toggle("hidden")}
function profile(){
  $("profileUsername").value=me.username||currentUser;
  $("profileStatus").value=me.status||"Disponível";
  $("profileBio").value=me.bio||"";
  $("profileMessage").textContent="";
  const file=$("profileAvatarFile");
  if(file)file.value="";
  renderAvatarPreview(me.avatar);
  $("profileModal").classList.remove("hidden");
}
function renderAvatarPreview(src){
  const p=$("avatarPreview");
  if(!p)return;
  p.replaceChildren();
  if(src && (String(src).startsWith("http")||String(src).startsWith("/api/avatars/")||String(src).startsWith("blob:"))){
    const img=document.createElement("img");
    img.src=src;
    img.alt="Foto de perfil";
    p.appendChild(img);
  }else{
    p.textContent="💬";
  }
}
async function saveProfile(){
  if(!ws||ws.readyState!==WebSocket.OPEN)return;
  const file=$("profileAvatarFile")?.files?.[0];
  try{
    let avatar=me.avatar||"💬";
    if(file){
      if(file.size>2_000_000)throw new Error("A foto deve ter no máximo 2 MB.");
      if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))
        throw new Error("Use PNG, JPG, WEBP ou GIF.");
      const res=await fetch("/api/avatar",{
        method:"POST",
        headers:{"Content-Type":file.type},
        body:file
      });
      const out=await res.json();
      if(!res.ok||!out.ok)throw new Error(out.message||"Falha ao enviar foto.");
      avatar=out.url||avatar;
    }
    // Preview immediately, before server response.
    renderAvatarPreview(avatar);
    ws.send(JSON.stringify({
      action:"profile",
      avatar,
      status:$("profileStatus").value,
      bio:$("profileBio").value
    }));
  }catch(e){
    $("profileMessage").textContent=e.message;
    $("profileMessage").style.color="#ef4444";
  }
}
function previewAvatar(){
  const file=$("profileAvatarFile")?.files?.[0];
  if(!file)return;
  if(file.size>2_000_000){$("profileMessage").textContent="A foto deve ter no máximo 2 MB.";return}
  const url=URL.createObjectURL(file);
  renderAvatarPreview(url);
}
function searchMessages(){const q=$("searchInput").value.trim().toLowerCase();document.querySelectorAll("#messages .msg .bubble").forEach(b=>b.parentElement.style.display=!q||b.textContent.toLowerCase().includes(q)?"":"none")}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

document.addEventListener("DOMContentLoaded",()=>{
  $("tabLogin").onclick=()=>tab(1);$("tabRegister").onclick=()=>tab(2);$("loginButton").onclick=login;$("registerButton").onclick=register;
  $("loginPass").onkeydown=e=>{if(e.key==="Enter")login()};$("registerPass2").onkeydown=e=>{if(e.key==="Enter")register()};
  const bind=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};
  bind("imageButton","click",()=>$("imageInput").click());
  bind("imageInput","change",e=>{const f=e.target.files?.[0];if(f)uploadImage(f);e.target.value=""});
  bind("messageInput","paste",e=>{const f=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith("image/"));if(f){e.preventDefault();uploadImage(f.getAsFile())}});
  bind("generalButton","click",openGeneral);bind("cancelReply","click",cancelReply);bind("profileButton","click",profile);bind("closeProfile","click",()=>{const x=$("profileModal");if(x)x.classList.add("hidden")});bind("saveProfile","click",saveProfile);bind("profileAvatarFile","change",previewAvatar);
  bind("searchButton","click",()=>{$("searchBar").classList.toggle("hidden");$("searchInput").focus()});bind("closeSearch","click",()=>{$("searchBar").classList.add("hidden");$("searchInput").value="";document.querySelectorAll("#messages .msg").forEach(x=>x.style.display="")});bind("searchInput","input",searchMessages);
  bind("logoutButton","click",logout);bind("loadHistory","click",loadHistory);
  bind("themeToggle","click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
  applyTheme(localStorage.getItem("chat.theme")||"light");
  bind("recordButton","click",toggleRecording);bind("sendAudio","click",sendPendingAudio);bind("cancelAudio","click",cancelAudioPreview);
  bind("shareButton","click",toggleSharePanel);bind("closeShare","click",()=>$("sharePanel").classList.add("hidden"));bind("startShare","click",startShareFlow);
  bind("stopShare","click",()=>{if(shareInitiator)stopOwnerShare(true);else stopReceivingShare()});
  bind("fullScreen","click",()=>{$("screenVideo").requestFullscreen?.()});bind("closeScreen","click",()=>{if(shareInitiator)stopOwnerShare(true);else stopReceivingShare()});
  bind("stopRecording","click",stopRecording);bind("cancelRecording","click",cancelRecording);
  const saved=localStorage.getItem("pikachu.user");if(saved)$("loginUser").value=saved;
  fetch("/api/session").then(r=>{if(r.ok)connect()}).catch(()=>{});
});

function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  localStorage.setItem("chat.theme",theme);
  const btn=$("themeToggle");
  if(btn)btn.textContent=theme==="dark"?"Claro":"Escuro";
}
