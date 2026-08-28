let ws=null,self="",me={},current="general",replyTo=null,timer,contacts=[],mediaRecorder=null,audioChunks=[],recordStarted=0,recordTimer=null,sessionToken="";
let activeShare=null,sharePeers=new Map(),viewerPeer=null,viewerOwner=null,screenStream=null,shareTarget=null,shareInitiator=false,pendingViewerIce=[];
const $=id=>document.getElementById(id);

function auth(text,ok=false){$("authMessage").textContent=text;$("authMessage").style.color=ok?"#77c68e":"#ff8b8b"}
function tab(n){$("tabLogin").classList.toggle("active",n===1);$("tabRegister").classList.toggle("active",n===2);$("loginPanel").classList.toggle("hidden",n!==1);$("registerPanel").classList.toggle("hidden",n!==2);$("authMessage").textContent=""}
function connect(action,n,p){
 if(ws&&ws.readyState===WebSocket.OPEN)ws.close();
 ws=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}`);
 ws.onopen=()=>ws.send(JSON.stringify({action,nickname:n,password:p}));
 ws.onerror=()=>auth("Falha ao conectar ao servidor.");
 ws.onclose=()=>{if(!$("chatApp").classList.contains("hidden"))$("onlineStatus").textContent="● OFFLINE"};
 ws.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(err){console.error(err)}};
}
function login(){const n=$("loginUser").value.trim(),p=$("loginPass").value;if(!n||!p)return auth("Preencha usuário e senha.");connect("login",n,p)}
function register(){const n=$("registerUser").value.trim(),p=$("registerPass").value,p2=$("registerPass2").value;if(!n||!p||!p2)return auth("Preencha todos os campos.");if(p.length<4)return auth("A senha precisa ter pelo menos 4 caracteres.");if(p!==p2)return auth("As senhas não conferem.");connect("register",n,p)}

function handle(m){
 if(m.type==="error"){if(m.code==="LOGIN"||m.code==="REGISTER")auth(m.message);else alert(m.message);return}
 if(m.type==="registered"){tab(1);$("loginUser").value=m.nickname;$("loginPass").value="";localStorage.setItem("pikachu.user",m.nickname);auth("Cadastro realizado. Faça login.",true);return}
 if(m.type==="welcome"){
   self=m.self;sessionToken=m.sessionToken||"";me=m.me||{username:self};contacts=m.contacts||[];activeShare=m.share||null;localStorage.setItem("pikachu.user",self);
   $("loginView").classList.add("hidden");$("chatApp").classList.remove("hidden");
   renderOnline(m.online||[]);renderContacts(contacts);renderShareState();openGeneralWithMessages(m.general||[]);return;
 }
 if(m.type==="directory"){contacts=m.contacts||contacts;renderContacts(contacts);return}
 if(m.type==="presence"){renderOnline(m.online||[]);return}
 if(m.type==="system"){if(current==="general")addSystem(m.message,m.timestamp);return}
 if(m.type==="generalHistory"){if(current==="general")renderMessages(m.messages||[]);return}
 if(m.type==="privateHistory"){if(current===privateKey(m.with))renderMessages(m.messages||[]);return}
 if(m.type==="message"||m.type==="messageUpdated"){if(current==="general")upsert(m);return}
 if(m.type==="audio"){const peer=m.from.toLowerCase()===self.toLowerCase()?m.to:m.from;if((m.to==null&&current==="general")||(m.to&&current===privateKey(peer)))addAudio(m);return}
 if(m.type==="private"||m.type==="privateUpdated"){
   const peer=(m.from.toLowerCase()===self.toLowerCase()?m.to:m.from);
   if(current===privateKey(peer))upsert(m);updateUnread(m);if(m.from!==self)notify(m);return;
 }
 if(m.type==="shareAvailable"){activeShare=m.share||null;renderShareState();return}
 if(m.type==="shareUnavailable"){activeShare=null;renderShareState();return}
 if(m.type==="shareRequest"){handleShareRequest(m);return}
 if(m.type==="shareOffer"){receiveShareOffer(m);return}
 if(m.type==="shareAnswer"){receiveShareAnswer(m);return}
 if(m.type==="shareIce"){receiveShareIce(m);return}
 if(m.type==="shareStopped"){activeShare=null;renderShareState();stopReceivingShare();return}
 if(m.type==="shareError"){alert(m.message);return}
 if(m.type==="typing"){
   if(m.from===self)return;
   const expected=m.scope==="general"?"general":privateKey(m.from);
   $("typingIndicator").textContent=(current===expected&&m.active)?m.from+" está digitando...":"";
   return;
 }
 if(m.type==="read")return;
 if(m.type==="profile"){me=m.me||me;$("profileMessage").textContent="Perfil salvo.";return}
}
function privateKey(name){return "private:"+String(name).toLowerCase()}
function renderOnline(list){$("onlineStatus").textContent="● ONLINE";$("onlineCount").textContent=list.length}
function avatarMarkup(src,fallback="💬"){
  if(src&&String(src).startsWith("http"))return `<img class="avatar-img" src="${esc(src)}" alt="">`;
  return esc(fallback);
}
function updateVisibleAvatar(username,src){
  document.querySelectorAll("[data-user]").forEach(el=>{
    if(el.dataset.user?.toLowerCase()===String(username).toLowerCase()){
      const av=el.querySelector(".conversation-avatar");if(av)av.innerHTML=avatarMarkup(src);
    }
  });
}
function renderContacts(list){
 const box=$("privateList");box.replaceChildren();
 for(const c of list){
   const b=document.createElement("button");b.type="button";b.className="conversation-item";b.dataset.user=c.username;
   b.innerHTML=`<span class="conversation-avatar">${avatarMarkup(c.avatar)}</span><span class="conversation-copy"><b>${esc(c.username)}</b><small>${esc(c.last?.text?.slice(0,28)||c.status||"conversa privada")}</small></span>${c.unread?`<span class="unread">${c.unread}</span>`:""}`;
   b.onclick=()=>openPrivate(c.username,b);box.appendChild(b);
 }
}
function markActive(el){document.querySelectorAll(".conversation-item").forEach(x=>x.classList.remove("active"));el?.classList.add("active")}
function openGeneralWithMessages(list){current="general";markActive($("generalButton"));$("chatIcon").textContent="⚡";$("chatTitle").textContent="canal-geral";$("chatSubtitle").textContent="Todos os agentes";$("typingIndicator").textContent="";renderMessages(list)}
function openGeneral(){
 if(ws?.readyState!==WebSocket.OPEN)return;
 current="general";markActive($("generalButton"));$("chatIcon").textContent="⚡";$("chatTitle").textContent="canal-geral";$("chatSubtitle").textContent="Todos os agentes";$("typingIndicator").textContent="";ws.send(JSON.stringify({action:"openGeneral"}));$("messageInput").focus()
}
function openPrivate(name,button){
 current=privateKey(name);markActive(button);$("chatIcon").textContent="●";$("chatTitle").textContent=name;$("chatSubtitle").textContent="conversa privada";$("typingIndicator").textContent="";$("messages").replaceChildren();
 const c=contacts.find(x=>x.username.toLowerCase()===name.toLowerCase());if(c)c.unread=0;renderContacts(contacts);
 ws.send(JSON.stringify({action:"openPrivate",to:name}));$("messageInput").focus()
}

async function toggleRecording(){
  if(mediaRecorder){stopRecording();return}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert("Seu navegador não suporta gravação de áudio.");return}
  if(!window.isSecureContext){alert("Por segurança, o microfone exige localhost ou HTTPS.");return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
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
  pendingAudioBlob=null;pendingAudioDuration=0;
  $("audioPreview").pause();$("audioPreview").removeAttribute("src");$("audioPreview").load();
  $("audioPreviewBar").classList.add("hidden");
}
async function sendPendingAudio(){
  if(!pendingAudioBlob)return;
  await uploadAudio(pendingAudioBlob,pendingAudioDuration);
  cancelAudioPreview();
}
async function uploadAudio(blob,duration){
  if(!ws||ws.readyState!==WebSocket.OPEN)return alert("O chat está desconectado.");
  const headers={"Content-Type":blob.type||"audio/webm","X-Pikachu-User":self,"X-Pikachu-Scope":current==="general"?"general":"private","X-Pikachu-Duration":String(duration)};
  if(current!=="general")headers["X-Pikachu-To"]=current.slice(8);
  if(replyTo)headers["X-Pikachu-Reply"]=replyTo;
  try{
    const res=await fetch("/api/audio",{method:"POST",headers,body:blob});
    const out=await res.json();if(!res.ok||!out.ok)throw new Error(out.message||"Falha ao enviar áudio");
    cancelReply();
  }catch(e){alert("Não foi possível enviar o áudio: "+e.message)}
}
function audioExtension(type){if(type.includes("ogg"))return"ogg";if(type.includes("mp4"))return"m4a";if(type.includes("wav"))return"wav";return"webm"}
function addAudio(m){
 const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
 const d=document.createElement("div");d.className="msg"+(m.from===self?" mine":"");d.dataset.mid=m.id;
 const meta=document.createElement("div");meta.className="meta";meta.textContent=`[${new Date(m.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}] ${m.from}`;
 const wrap=document.createElement("div");wrap.className="bubble audio-message";
 const audio=document.createElement("audio");
 audio.controls=true;audio.preload="metadata";
 audio.src=new URL(m.url,location.origin).href;
 audio.addEventListener("error",()=>{dur.textContent="Áudio indisponível";console.warn("Erro ao carregar áudio",audio.src,audio.error)});
 audio.addEventListener("loadedmetadata",()=>{if(!m.duration||Number(m.duration)<=0)dur.textContent=formatDuration(audio.duration)});
 const dur=document.createElement("span");dur.className="audio-duration";dur.textContent=formatDuration(m.duration);
 wrap.append(audio,dur);d.append(meta,wrap);$("messages").appendChild(d);bottom();
}
function formatDuration(sec){sec=Math.round(Number(sec)||0);return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function renderMessages(list){
 $("messages").replaceChildren();
 if(!list.length){$("messages").innerHTML='<div class="empty"><div><b>Nenhuma mensagem ainda</b>Comece a conversa.</div></div>';return}
 list.forEach(m=>m.type==="audio"||m.kind==="audio"?addAudio(m):addMessage(m));bottom()
}
function upsert(m){const el=document.querySelector(`[data-mid="${CSS.escape(m.id)}"]`);if(el){const b=el.querySelector(".bubble");if(b)b.textContent=m.deleted?"Mensagem excluída":m.text;return}addMessage(m)}
function addImageMessage(m){
 const wrap=document.createElement("div");wrap.className="msg "+(m.from===self?"mine":"theirs");wrap.dataset.id=m.id||"";
 const b=document.createElement("div");b.className="bubble image-bubble";
 const im=document.createElement("img");im.src=m.url;im.alt="Imagem enviada";im.loading="lazy";im.onclick=()=>window.open(m.url,"_blank");
 im.onerror=()=>{b.textContent="Não foi possível carregar a imagem."};
 b.appendChild(im);wrap.appendChild(b);$("messages").appendChild(wrap);$("messages").scrollTop=$("messages").scrollHeight;
}
async function uploadImage(file){
 if(!file||!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){alert("Selecione uma imagem PNG, JPG, WEBP ou GIF.");return}
 if(file.size>8*1024*1024){alert("A imagem deve ter no máximo 8 MB.");return}
 const privateChat=current!=="general",to=privateChat?current.slice(8):"";
 const r=await fetch("/api/image",{method:"POST",headers:{"Content-Type":file.type,"x-pikachu-session":sessionToken,"x-pikachu-scope":privateChat?"private":"general","x-pikachu-to":to},body:file});
 const d=await r.json().catch(()=>({ok:false,message:"Falha ao enviar imagem."}));
 if(!r.ok||!d.ok)alert(d.message||"Falha ao enviar imagem.");
}
function addMessage(m){
 const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
 const d=document.createElement("div");d.className="msg"+(m.from===self?" mine":"");d.dataset.mid=m.id;
 const meta=document.createElement("div");meta.className="meta";meta.textContent=`[${new Date(m.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}] ${m.from}`;
 const b=document.createElement("div");b.className="bubble";b.textContent=m.deleted?"Mensagem excluída":m.text;if(!m.deleted)b.onclick=()=>reply(m);
 d.append(meta,b);if(m.edited&&!m.deleted){const e=document.createElement("div");e.className="edited";e.textContent="editada";d.append(e)}
 $("messages").appendChild(d);bottom();if(m.from!==self&&current!=="general")ws.send(JSON.stringify({action:"markRead",id:m.id}))
}
function addSystem(t,ts){const d=document.createElement("div");d.className="msg system";d.textContent=`[${new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}] ${t}`;$("messages").appendChild(d);bottom()}
function bottom(){$("messages").scrollTop=$("messages").scrollHeight}
function reply(m){replyTo=m.id;$("replyPreview").textContent=`Respondendo a ${m.from}: ${m.text.slice(0,90)}`;$("replyBar").classList.remove("hidden");$("messageInput").focus()}
function cancelReply(){replyTo=null;$("replyBar").classList.add("hidden")}
function send(){
 const text=$("messageInput").value.trim();if(!text||!ws||ws.readyState!==WebSocket.OPEN)return;
 const d=current==="general"?{action:"general",text}:{action:"private",to:current.replace(/^private:/,""),text};if(replyTo)d.replyTo=replyTo;
 ws.send(JSON.stringify(d));$("messageInput").value="";cancelReply();sendTyping(false);$("messageInput").focus()
}
$("messageForm").onsubmit=e=>{e.preventDefault();send()}
$("messageInput").oninput=()=>{sendTyping($("messageInput").value.length>0);clearTimeout(timer);timer=setTimeout(()=>sendTyping(false),900)}
function sendTyping(active){if(!ws||ws.readyState!==WebSocket.OPEN)return;const d={action:"typing",active,scope:current==="general"?"general":"private"};if(current!=="general")d.to=current.replace(/^private:/,"");ws.send(JSON.stringify(d))}
function updateUnread(m){if(m.from===self)return;const peer=m.from;const c=contacts.find(x=>x.username.toLowerCase()===peer.toLowerCase());if(c&&current!==privateKey(peer))c.unread=(c.unread||0)+1;renderContacts(contacts)}
function notify(m){if(m.from===self||!document.hidden||!("Notification"in window))return;if(Notification.permission==="granted")new Notification("⚡ "+m.from,{body:m.text})}

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
function explainShareError(e){
 const n=e?.name||"erro";
 if(n==="NotAllowedError")return"O compartilhamento foi cancelado ou bloqueado.";
 if(n==="SecurityError")return"Use localhost ou HTTPS para compartilhar a tela.";
 if(n==="NotReadableError")return"O navegador não conseguiu capturar essa tela.";
 return"Não foi possível iniciar o compartilhamento ("+n+").";
}
function explainShareError(e){
 const n=e?.name||"erro";
 if(n==="NotAllowedError")return"O compartilhamento foi cancelado ou bloqueado.";
 if(n==="SecurityError")return"Use HTTPS ou localhost para compartilhar a tela.";
 if(n==="NotReadableError")return"O navegador não conseguiu capturar essa tela.";
 return"Não foi possível iniciar o compartilhamento ("+n+").";
}
function makePeer(target,isOwner){
 const pc=new RTCPeerConnection({
  iceServers:[
   {urls:"stun:stun.l.google.com:19302"},
   {urls:"stun:stun1.l.google.com:19302"}
  ]
 });
 pc._target=target;pc._owner=isOwner;pc._pending=[];
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
  shareTarget=target;shareInitiator=true;sharePeers.clear();
  activeShare={owner:self,scope,target,startedAt:new Date().toISOString(),self:true};
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
 const peer=makePeer(m.from,true);sharePeers.set(m.from.toLowerCase(),peer);
 screenStream.getVideoTracks().forEach(t=>peer.addTrack(t,screenStream));
 await configureSender(peer);
 try{const offer=await peer.createOffer();await peer.setLocalDescription(offer);ws.send(JSON.stringify({action:"shareOffer",to:m.from,offer:peer.localDescription}))}catch{stopOwnerPeer(m.from)}
}
function stopOwnerPeer(name){
 const key=String(name).toLowerCase(),peer=sharePeers.get(key);if(peer){try{peer.close()}catch{}sharePeers.delete(key)}
}
async function receiveShareOffer(m){
  if(viewerPeer)try{viewerPeer.close()}catch{}
  viewerOwner=m.from;
  const queuedIce=pendingViewerIce.splice(0);viewerPeer=makePeer(m.from,false);
  try{
    await viewerPeer.setRemoteDescription(new RTCSessionDescription(m.offer));
    if(queuedIce.length){
      const q=queuedIce;
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
  if(!m.candidate)return;
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
 activeShare.viewing=true;renderShareState();$("screenStatus").textContent="Conectando à tela de "+owner+"...";
 ws.send(JSON.stringify({action:"shareRequest",owner}));
}
function stopOwnerShare(notify=true){
 const target=shareTarget;
 for(const k of [...sharePeers.keys()])stopOwnerPeer(k);
 if(screenStream)screenStream.getTracks().forEach(t=>t.stop());screenStream=null;
 if(notify&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"shareStop"}));
 $("screenVideo").srcObject=null;$("screenOverlay").classList.add("hidden");activeShare=null;shareTarget=null;shareInitiator=false;renderShareState()
}
function stopReceivingShare(){
 if(viewerPeer){try{viewerPeer.close()}catch{};viewerPeer=null}
 pendingViewerIce=[];
 $("screenVideo").srcObject=null;$("screenOverlay").classList.add("hidden");viewerOwner=null
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
  $("profileUsername").value=me.username||self;
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
  if(src && (String(src).startsWith("http")||String(src).startsWith("/avatars/"))){
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
        headers:{"Content-Type":file.type,"X-Pikachu-User":self},
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
  bind("logoutButton","click",()=>{try{ws?.close()}catch{};location.reload()});
  bind("themeToggle","click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
  applyTheme(localStorage.getItem("chat.theme")||"light");
  bind("recordButton","click",toggleRecording);bind("sendAudio","click",sendPendingAudio);bind("cancelAudio","click",cancelAudioPreview);
  bind("shareButton","click",toggleSharePanel);bind("closeShare","click",()=>$("sharePanel").classList.add("hidden"));bind("startShare","click",startShareFlow);
  bind("stopShare","click",()=>{if(shareInitiator)stopOwnerShare(true);else stopReceivingShare()});
  bind("fullScreen","click",()=>{$("screenVideo").requestFullscreen?.()});bind("closeScreen","click",()=>{if(shareInitiator)stopOwnerShare(false);else stopReceivingShare()});
  bind("stopRecording","click",stopRecording);bind("cancelRecording","click",cancelRecording);
  const saved=localStorage.getItem("pikachu.user");if(saved)$("loginUser").value=saved;
  if("Notification"in window&&Notification.permission==="default")Notification.requestPermission().catch(()=>{});
});

function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  localStorage.setItem("chat.theme",theme);
  const btn=$("themeToggle");
  if(btn)btn.textContent=theme==="dark"?"Claro":"Escuro";
}async function saveProfile(){
  if(!ws||ws.readyState!==WebSocket.OPEN)return;
  const file=$("profileAvatarFile").files[0];
  try{
    let avatar=me.avatar||"💬";
    if(file){
      if(file.size>2_000_000)throw new Error("A foto deve ter no máximo 2 MB.");
      const type=file.type;
      if(!["image/png","image/jpeg","image/webp","image/gif"].includes(type))throw new Error("Use PNG, JPG, WEBP ou GIF.");
      const res=await fetch("/api/avatar",{method:"POST",headers:{"Content-Type":type,"X-Pikachu-User":self},body:file});
      const out=await res.json();if(!res.ok||!out.ok)throw new Error(out.message||"Falha ao enviar foto");avatar=out.url;
    }
    ws.send(JSON.stringify({action:"profile",avatar,status:$("profileStatus").value,bio:$("profileBio").value}));
  }catch(e){$("profileMessage").textContent=e.message;$("profileMessage").style.color="#ef4444"}
}

