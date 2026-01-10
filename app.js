import { db, ensureAnonAuth } from "./firebase.js";

import {
  doc, setDoc, getDoc, updateDoc,
  collection, onSnapshot, serverTimestamp,
  query, orderBy, getDocs, writeBatch, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const el = (id) => document.getElementById(id);

// Lobby
const lobbyCard = el("lobbyCard");
const lobbyHome = el("lobbyHome");
const createForm = el("createForm");
const joinForm = el("joinForm");
const lobbyMsg = el("lobbyMsg");

const goCreateBtn = el("goCreateBtn");
const goJoinBtn = el("goJoinBtn");
const backHome1 = el("backHome1");
const backHome2 = el("backHome2");

const nameCreate = el("nameCreate");
const roundsCreate = el("roundsCreate");
const askTimeCreate = el("askTimeCreate");
const voteTimeCreate = el("voteTimeCreate");
const createBtn = el("createBtn");
const createMsg = el("createMsg");

const nameJoin = el("nameJoin");
const codeJoin = el("codeJoin");
const joinBtn = el("joinBtn");
const joinMsg = el("joinMsg");

// Room
const roomCard = el("roomCard");

// Top Bar
const topBar = el("topBar");
const turnNow = el("turnNow");
const readyCountTop = el("readyCountTop");
const timerTop = el("timerTop");
const roomCodeEl = el("roomCode");
const copyCodeBtn = el("copyCodeBtn");
const playerCountEl = el("playerCount");

// Me
const meNameEl = el("meName");
const meScoreEl = el("meScore");
const meReadyPill = el("meReadyPill");
const readyBtn = el("readyBtn");
const leaveBtn = el("leaveBtn");

// Players accordion
const playersSummary = el("playersSummary");
const playersEl = el("players");

// Mini leaderboard
const miniLeaderboard = el("miniLeaderboard");

// Start box (owner)
const startBox = el("startBox");
const startBtn = el("startBtn");
const startMsg = el("startMsg");
const readyCountText = el("readyCountText");
const kpiRounds = el("kpiRounds");
const kpiPlayers = el("kpiPlayers");
const kpiTurns = el("kpiTurns");
const kpiAskTime = el("kpiAskTime");
const kpiVoteTime = el("kpiVoteTime");

// Asking
const askBox = el("askBox");
const qText = el("qText");
const opt0 = el("opt0");
const opt1 = el("opt1");
const opt2 = el("opt2");
const opt3 = el("opt3");
const publishBtn = el("publishBtn");
const skipBtn = el("skipBtn");
const askMsg = el("askMsg");

// Voting
const voteBox = el("voteBox");
const qTitle = el("qTitle");
const voteSub = el("voteSub");
const choices = el("choices");
const voteMsg = el("voteMsg");

// Finish
const finishBox = el("finishBox");
const podium = el("podium");
const leader = el("leader");
const restartBtn = el("restartBtn");
const backToLobbyBtn = el("backToLobbyBtn");

// State
let user = null;
let currentRoomCode = null;
let unsubRoom = null;
let unsubPlayers = null;
let roomCache = null;
let playersCache = [];
let tickTimer = null;

// Local UI state (for reveal + sounds)
let lastBellQid = null;
let lastEndBeepQid = null;
let lastTickSecond = null;
let lastRenderedRevealQid = null;

// Audio
let audioEnabled = true;
let audioUnlocked = false;
let audioCtx = null;
let soundBtn = null;

function nowMs(){ return Date.now(); }
function fmtSecLeft(msLeft){
  const s = Math.max(0, Math.ceil(msLeft/1000));
  return `${s}s`;
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

function cleanupSubs(){
  if (unsubRoom) unsubRoom();
  if (unsubPlayers) unsubPlayers();
  unsubRoom = null; unsubPlayers = null;
  roomCache = null; playersCache = [];
  stopTick();
}

function stopTick(){
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  timerTop.textContent = "—";
  lastTickSecond = null;
  lastEndBeepQid = null;
}

function startTick(){
  stopTick();
  tickTimer = setInterval(() => tick(), 250);
}

function showOnly(target){
  lobbyHome.classList.add("hidden");
  createForm.classList.add("hidden");
  joinForm.classList.add("hidden");
  target.classList.remove("hidden");
}

function showLobby(msg=""){
  cleanupSubs();
  currentRoomCode = null;

  lobbyCard.classList.remove("hidden");
  roomCard.classList.add("hidden");
  topBar.classList.add("hidden");

  showOnly(lobbyHome);
  lobbyMsg.textContent = msg;
  createMsg.textContent = "";
  joinMsg.textContent = "";
}

function showRoom(){
  lobbyCard.classList.add("hidden");
  roomCard.classList.remove("hidden");
  topBar.classList.remove("hidden");
}

function resetBoxes(){
  startBox.classList.add("hidden");
  askBox.classList.add("hidden");
  voteBox.classList.add("hidden");
  finishBox.classList.add("hidden");
}

function setReadyUI(isReady){
  meReadyPill.textContent = isReady ? "Ready" : "Waiting";
  meReadyPill.classList.toggle("pillReady", !!isReady);
  meReadyPill.classList.toggle("pillWait", !isReady);
  readyBtn.textContent = isReady ? "Cancel Ready" : "I'm Ready";
}

function codeGen(len=6){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s="";
  for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function mustValue(inputEl,msgEl,message){
  const v=(inputEl.value||"").trim();
  if(!v){ msgEl.textContent=message; return null; }
  return v;
}

function countReady(list){
  const ready = list.filter(p=>!!p.ready).length;
  return { ready, total:list.length };
}

function isAllReady(list){
  const {ready,total}=countReady(list);
  return total>0 && ready===total;
}

function computeOrderFromRoom(room, players){
  if (Array.isArray(room.playerOrder) && room.playerOrder.length) return room.playerOrder;
  return [...players].sort((a,b)=> (a.joinedAtMs||0)-(b.joinedAtMs||0)).map(p=>p.uid);
}

function getPlayerName(uid){
  const p = playersCache.find(x=>x.uid===uid);
  return p?.name || "—";
}

function getMe(){
  return playersCache.find(p=>p.uid===user?.uid) || null;
}

// ✅ owner by uid or by name
function isOwner(room){
  const me = getMe();
  const myName = (me?.name || "").trim();
  const ownerName = (room?.ownerName || "").trim();
  return (room?.ownerUid === user?.uid) || (ownerName && myName && ownerName === myName);
}

/**
 * ✅ FIX: update Start button when players ready changes
 */
function refreshStartBoxUI(){
  if (!roomCache) return;
  if (roomCache.status !== "WAITING") return;
  if (!isOwner(roomCache)) return;

  startBox.classList.remove("hidden");

  const allReady = isAllReady(playersCache);
  startBtn.disabled = !allReady;
  startMsg.textContent = allReady ? "الكل جاهز. تقدر تبدأ." : "انتظر لين الجميع يصير Ready.";
}

/* ---------- Audio (bell + timer ticks + end beep) ---------- */

function ensureAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function unlockAudio(){
  try{
    const ctx = ensureAudio();
    if (ctx.state === "suspended") ctx.resume();
    audioUnlocked = true;
  }catch{}
}

document.addEventListener("pointerdown", ()=>{ unlockAudio(); }, { once:false });

function playTone({freq=880, durationMs=120, type="sine", gain=0.05} = {}){
  if(!audioEnabled || !audioUnlocked) return;
  try{
    const ctx = ensureAudio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + durationMs/1000);
  }catch{}
}

function playBell(){
  // little bell: 2 quick tones
  playTone({freq: 988, durationMs: 110, type:"triangle", gain:0.05});
  setTimeout(()=>playTone({freq: 1319, durationMs: 140, type:"triangle", gain:0.045}), 130);
}

function playTick(){
  playTone({freq: 660, durationMs: 55, type:"square", gain:0.03});
}

function playTimeUp(){
  playTone({freq: 220, durationMs: 180, type:"sine", gain:0.06});
  setTimeout(()=>playTone({freq: 165, durationMs: 220, type:"sine", gain:0.055}), 190);
}

function mountSoundToggle(){
  // optional: add a small button in topbar if not exists
  if(!topBar) return;
  if(soundBtn) return;

  soundBtn = document.createElement("button");
  soundBtn.className = "btn miniBtn";
  soundBtn.type = "button";
  soundBtn.style.marginInlineStart = "8px";
  soundBtn.textContent = "Sound: On";

  soundBtn.addEventListener("click", ()=>{
    audioEnabled = !audioEnabled;
    soundBtn.textContent = audioEnabled ? "Sound: On" : "Sound: Off";
    unlockAudio();
  });

  // try to append near copy button / room code
  try{
    copyCodeBtn?.parentElement?.appendChild(soundBtn);
  }catch{
    topBar.appendChild(soundBtn);
  }
}

/* ---------- UI render helpers ---------- */

function renderMiniLeaderboard(players){
  const sorted = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  miniLeaderboard.innerHTML = "";
  sorted.slice(0,6).forEach((p,i)=>{
    const row=document.createElement("div");
    row.className="miniRow";
    const n=document.createElement("div");
    n.className="miniName";
    n.textContent = `${i+1}. ${p.name || "—"}`;
    const s=document.createElement("div");
    s.className="miniScore";
    s.textContent = `${p.score||0}`;
    row.appendChild(n); row.appendChild(s);
    miniLeaderboard.appendChild(row);
  });
}

function renderPlayers(players, ownerUid, ownerName){
  playersEl.innerHTML = "";
  const sortedJoin = [...players].sort((a,b)=>(a.joinedAtMs||0)-(b.joinedAtMs||0));
  const ownerNameClean = (ownerName || "").trim();

  const voting = (roomCache?.status==="STARTED" && roomCache?.phase==="VOTING" && !!roomCache?.currentQuestion);
  const q = voting ? roomCache.currentQuestion : null;
  const answeredSet = new Set((q?.answeredUids)||[]);

  sortedJoin.forEach(p=>{
    const row=document.createElement("div");
    row.className="playerRow";

    // voting status colors
    if(voting && q){
      const isAsker = p.uid === q.askerUid;
      const isAnswered = answeredSet.has(p.uid);

      row.classList.remove("stateAsker","stateAnswered","statePending");
      if(isAsker) row.classList.add("stateAsker");
      else if(isAnswered) row.classList.add("stateAnswered");
      else row.classList.add("statePending");
    }

    const left=document.createElement("div");
    left.className="playerMain";

    const name=document.createElement("div");
    name.className="playerName";
    name.textContent=p.name || "—";
    left.appendChild(name);

    const isOwnerByUid = (p.uid===ownerUid);
    const isOwnerByName = (!!ownerNameClean && (p.name||"").trim()===ownerNameClean);

    if (isOwnerByUid || isOwnerByName){
      const b=document.createElement("span");
      b.className="badge badgeOwner";
      b.textContent="Owner";
      left.appendChild(b);
    }
    if (p.uid===user.uid){
      const b=document.createElement("span");
      b.className="badge badgeYou";
      b.textContent="You";
      left.appendChild(b);
    }

    // pending indicator (during voting)
    if(voting && q){
      const pill=document.createElement("span");
      pill.className="badge badgeState";
      if(p.uid === q.askerUid){
        pill.textContent = "Asker";
      }else if(answeredSet.has(p.uid)){
        pill.textContent = "Voted";
      }else{
        pill.textContent = "Pending";
      }
      left.appendChild(pill);
    }

    const right=document.createElement("div");
    right.className="playerMeta";

    const pts=document.createElement("span");
    pts.className="metaBox";
    pts.textContent=`Points: ${p.score||0}`;

    const st=document.createElement("span");
    st.className="metaBox";
    st.textContent= p.ready ? "Ready" : "Waiting";

    right.appendChild(pts);
    right.appendChild(st);

    row.appendChild(left);
    row.appendChild(right);
    playersEl.appendChild(row);
  });

  playersSummary.textContent = `${players.length} لاعب`;
  playerCountEl.textContent = String(players.length);
}

function renderFinish(players){
  const sorted=[...players].sort((a,b)=>(b.score||0)-(a.score||0));

  // keep top3 podium as-is
  podium.innerHTML="";
  const top3 = [sorted[0],sorted[1],sorted[2]].filter(Boolean);
  const labels = ["المركز الأول","المركز الثاني","المركز الثالث"];

  for (let i=0;i<3;i++){
    const p = top3[i];
    const box=document.createElement("div");
    box.className="podItem";
    const r=document.createElement("div");
    r.className="podRank";
    r.textContent = labels[i];
    const n=document.createElement("div");
    n.className="podName";
    n.textContent = p ? (p.name||"—") : "—";
    const pts=document.createElement("div");
    pts.className="podPts";
    pts.textContent = p ? `Points: ${p.score||0}` : "";
    box.appendChild(r); box.appendChild(n); box.appendChild(pts);
    podium.appendChild(box);
  }

  // full leaderboard (all players) + highlight top 3
  leader.innerHTML="";
  sorted.forEach((p,i)=>{
    const row=document.createElement("div");
    row.className="leaderRow";
    if(i===0) row.classList.add("leaderTop1");
    if(i===1) row.classList.add("leaderTop2");
    if(i===2) row.classList.add("leaderTop3");

    const l=document.createElement("div");
    l.className="leaderName";
    l.textContent=`${i+1}. ${p.name||"—"}`;
    const r=document.createElement("div");
    r.className="leaderScore";
    r.textContent=`Points: ${p.score||0}`;
    row.appendChild(l); row.appendChild(r);
    leader.appendChild(row);
  });
}

async function init(){
  user = await ensureAnonAuth();
  showLobby("");
  mountSoundToggle();
}
init();

/* Lobby navigation */
goCreateBtn.addEventListener("click", ()=>{
  showOnly(createForm);
  createMsg.textContent="";
  nameCreate.focus();
});
goJoinBtn.addEventListener("click", ()=>{
  showOnly(joinForm);
  joinMsg.textContent="";
  nameJoin.focus();
});
backHome1.addEventListener("click", ()=>showLobby(""));
backHome2.addEventListener("click", ()=>showLobby(""));

/* Enter triggers */
nameCreate.addEventListener("keydown",(e)=>{ if(e.key==="Enter") createBtn.click(); });
roundsCreate.addEventListener("keydown",(e)=>{ if(e.key==="Enter") createBtn.click(); });
askTimeCreate.addEventListener("keydown",(e)=>{ if(e.key==="Enter") createBtn.click(); });
voteTimeCreate.addEventListener("keydown",(e)=>{ if(e.key==="Enter") createBtn.click(); });

nameJoin.addEventListener("keydown",(e)=>{ if(e.key==="Enter") joinBtn.click(); });
codeJoin.addEventListener("keydown",(e)=>{ if(e.key==="Enter") joinBtn.click(); });

/* Copy code */
copyCodeBtn.addEventListener("click", async ()=>{
  const code=(roomCodeEl.textContent||"").trim();
  if(!code || code==="—") return;
  try{
    await navigator.clipboard.writeText(code);
    copyCodeBtn.textContent="تم";
    setTimeout(()=>copyCodeBtn.textContent="نسخ",900);
  }catch{
    alert("انسخ يدويًا: "+code);
  }
});

/* Create room */
createBtn.addEventListener("click", async ()=>{
  createMsg.textContent="";

  const name = mustValue(nameCreate, createMsg, "اكتب اسمك.");
  if(!name) return;

  const rounds = clamp(Number(roundsCreate.value||1), 1, 20);
  const askTimeSec = clamp(Number(askTimeCreate.value||30), 10, 120);
  const voteTimeSec = clamp(Number(voteTimeCreate.value||20), 10, 120);

  const code = codeGen(6);
  const roomRef = doc(db,"rooms",code);
  const playerRef = doc(db,"rooms",code,"players",user.uid);

  await setDoc(roomRef,{
    ownerUid: user.uid,
    ownerName: name,
    createdAt: serverTimestamp(),

    status: "WAITING",         // WAITING | STARTED | FINISHED
    phase: "ASKING",           // ASKING | VOTING
    roundsRequested: rounds,

    askTimeSec,
    voteTimeSec,

    playerOrder: null,
    totalTurns: null,
    turnNum: 0,

    qCounter: 0,
    currentQuestion: null,

    phaseEndsAtMs: null
  });

  await setDoc(playerRef,{
    name,
    score: 0,
    ready: false,
    joinedAt: serverTimestamp(),
    joinedAtMs: nowMs()
  });

  await enterRoom(code);
});

/* Join room */
joinBtn.addEventListener("click", async ()=>{
  joinMsg.textContent="";

  const name = mustValue(nameJoin, joinMsg, "اكتب اسمك.");
  if(!name) return;

  const code=(codeJoin.value||"").trim().toUpperCase();
  if(!code){ joinMsg.textContent="اكتب كود الروم."; return; }

  const roomRef=doc(db,"rooms",code);
  const snap=await getDoc(roomRef);
  if(!snap.exists()){ joinMsg.textContent="الروم غير موجود."; return; }

  const data=snap.data();
  if(data.status && data.status!=="WAITING"){
    joinMsg.textContent="اللعبة بدأت. لا يمكن الانضمام الآن.";
    return;
  }

  const playerRef=doc(db,"rooms",code,"players",user.uid);
  await setDoc(playerRef,{
    name,
    score:0,
    ready:false,
    joinedAt: serverTimestamp(),
    joinedAtMs: nowMs()
  },{merge:true});

  await enterRoom(code);
});

/* Leave */
leaveBtn.addEventListener("click", ()=>{
  showLobby("");
});

/* Ready toggle */
readyBtn.addEventListener("click", async ()=>{
  if(!currentRoomCode) return;
  const pref=doc(db,"rooms",currentRoomCode,"players",user.uid);
  const ps=await getDoc(pref);
  if(!ps.exists()) return;
  const p=ps.data();
  await updateDoc(pref,{ ready: !p.ready });
});

/* Start (owner only) */
startBtn.addEventListener("click", async ()=>{
  startMsg.textContent = "";
  if(!currentRoomCode) return;

  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  if(!isOwner(room)){
    startMsg.textContent = "فقط الأونر يقدر يبدأ اللعبة.";
    return;
  }

  const playersSnap=await getDocs(query(collection(db,"rooms",currentRoomCode,"players"),orderBy("joinedAtMs","asc")));
  const players=playersSnap.docs.map(d=>({uid:d.id, ...d.data()}));

  if(!isAllReady(players)){
    startMsg.textContent="لازم كل اللاعبين يسوون Ready.";
    return;
  }

  const order=players.map(p=>p.uid);
  const rounds=clamp(Number(room.roundsRequested||1),1,20);
  const totalTurns=order.length*rounds;

  const askTimeSec = clamp(Number(room.askTimeSec||30),10,120);
  const phaseEndsAtMs = nowMs() + askTimeSec*1000;

  const me = players.find(p=>p.uid===user.uid);
  const patch = {};
  if(!room.ownerName && me?.name) patch.ownerName = me.name;

  await updateDoc(roomRef,{
    ...patch,
    status:"STARTED",
    phase:"ASKING",
    playerOrder: order,
    totalTurns,
    turnNum:0,
    currentQuestion:null,
    phaseEndsAtMs
  });

  startMsg.textContent="";
});

/* Finish buttons */
backToLobbyBtn.addEventListener("click", ()=>showLobby(""));

restartBtn.addEventListener("click", async ()=>{
  if(!currentRoomCode) return;
  const roomRef = doc(db,"rooms",currentRoomCode);
  const rs = await getDoc(roomRef);
  if(!rs.exists()) return;
  const room = rs.data();
  if(!isOwner(room)) return;

  const playersSnap=await getDocs(collection(db,"rooms",currentRoomCode,"players"));
  const batch=writeBatch(db);
  playersSnap.forEach(d=>{
    batch.update(d.ref,{
      score:0,
      ready:false,
      lastAnswerQid: null,
      lastAnswerIdx: null
    });
  });

  batch.update(roomRef,{
    status:"WAITING",
    phase:"ASKING",
    playerOrder:null,
    totalTurns:null,
    turnNum:0,
    qCounter:0,
    currentQuestion:null,
    phaseEndsAtMs:null
  });

  await batch.commit();
});

/* Enter room */
async function enterRoom(code){
  currentRoomCode = code;
  showRoom();
  resetBoxes();
  mountSoundToggle();

  roomCodeEl.textContent = code;

  const roomRef = doc(db,"rooms",code);
  const playersQ = query(collection(db,"rooms",code,"players"), orderBy("joinedAtMs","asc"));

  unsubPlayers = onSnapshot(playersQ,(qs)=>{
    const list=[];
    qs.forEach(d=> list.push({uid:d.id, ...d.data()}));
    playersCache = list;

    const me=list.find(p=>p.uid===user.uid);
    if(me){
      meNameEl.textContent = me.name || "—";
      meScoreEl.textContent = String(me.score||0);
      setReadyUI(!!me.ready);
    }

    if(roomCache){
      renderPlayers(list, roomCache.ownerUid, roomCache.ownerName);
    }
    renderMiniLeaderboard(list);

    const {ready,total}=countReady(list);
    readyCountTop.textContent = `${ready}/${total}`;
    readyCountText.textContent = `جاهزين ${ready}/${total}`;
    playerCountEl.textContent = String(total);

    refreshStartBoxUI();
  });

  unsubRoom = onSnapshot(roomRef, async (snap)=>{
    if(!snap.exists()){ showLobby("الروم انحذف."); return; }
    const room = snap.data();
    roomCache = room;

    resetBoxes();

    const order = computeOrderFromRoom(room, playersCache);
    const rounds = clamp(Number(room.roundsRequested||1),1,20);
    const totalTurns = Number(room.totalTurns || (order.length*rounds));
    const turnNum = Number(room.turnNum||0);

    const askerUid = order.length ? order[turnNum % order.length] : null;
    turnNow.textContent = askerUid ? getPlayerName(askerUid) : "—";

    kpiRounds.textContent = String(rounds);
    kpiPlayers.textContent = String(order.length || playersCache.length || 0);
    kpiTurns.textContent = String(totalTurns || 0);
    kpiAskTime.textContent = `${clamp(Number(room.askTimeSec||30),10,120)}s`;
    kpiVoteTime.textContent = `${clamp(Number(room.voteTimeSec||20),10,120)}s`;

    renderPlayers(playersCache, room.ownerUid, room.ownerName);

    if(room.status === "WAITING"){
      refreshStartBoxUI();
      restartBtn.classList.add("hidden");
      stopTick();
      return;
    }

    if(room.status === "FINISHED"){
      finishBox.classList.remove("hidden");
      renderFinish(playersCache);

      if(isOwner(room)){
        restartBtn.classList.remove("hidden");
      } else {
        restartBtn.classList.add("hidden");
      }

      stopTick();
      return;
    }

    // STARTED
    startTick();

    if(room.phase === "ASKING"){
      if(askerUid === user.uid){
        askBox.classList.remove("hidden");
        askMsg.textContent = "";
      }
      return;
    }

    if(room.phase === "VOTING"){
      voteBox.classList.remove("hidden");

      const q = room.currentQuestion;
      if(!q) return;

      // 🔔 Bell when a new question starts voting (once per client)
      if(q.qid && q.qid !== lastBellQid && !q.reveal){
        lastBellQid = q.qid;
        playBell();
        lastEndBeepQid = null;
        lastTickSecond = null;
        lastRenderedRevealQid = null;
      }

      qTitle.textContent = q.text || "—";
      renderChoices(q, order);
      return;
    }
  });
}

/* Asking: publish */
publishBtn.addEventListener("click", async ()=>{
  if(!currentRoomCode) return;

  if(!confirm("متأكد تبغى تنشر السؤال الآن؟")) return;

  const text=(qText.value||"").trim();
  const options=[opt0.value,opt1.value,opt2.value,opt3.value].map(v=>(v||"").trim());
  const checked=document.querySelector('input[name="correct"]:checked');
  const cidx=checked ? Number(checked.value) : null;

  if(!text){ askMsg.textContent="اكتب السؤال."; return; }
  if(options.some(o=>!o)){ askMsg.textContent="كمّل الأربع خيارات."; return; }
  if(cidx===null || ![0,1,2,3].includes(cidx)){ askMsg.textContent="حدد إجابة صحيحة واحدة."; return; }

  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  const voteTimeSec = clamp(Number(room.voteTimeSec||20),10,120);

  const order = computeOrderFromRoom(room, playersCache);
  const turnNum = Number(room.turnNum||0);
  const askerUid = order.length ? order[turnNum % order.length] : null;
  if(askerUid !== user.uid) return;

  const qid = String((room.qCounter||0)+1);

  // reset local sound flags for this question
  lastBellQid = null;
  lastEndBeepQid = null;
  lastTickSecond = null;
  lastRenderedRevealQid = null;

  await updateDoc(roomRef,{
    phase:"VOTING",
    qCounter:(room.qCounter||0)+1,
    currentQuestion:{
      qid,
      askerUid:user.uid,
      text,
      options,
      correctIndex:cidx,
      answeredUids:[],
      settled:false,
      reveal:false
    },
    phaseEndsAtMs: nowMs() + voteTimeSec*1000
  });

  qText.value="";
  opt0.value=""; opt1.value=""; opt2.value=""; opt3.value="";
  const first=document.querySelector('input[name="correct"][value="0"]');
  if(first) first.checked=true;
});

/* Asking: skip */
skipBtn.addEventListener("click", async ()=>{
  if(!currentRoomCode) return;
  if(!confirm("تأكيد تخطي الدور؟")) return;

  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  if(room.status!=="STARTED" || room.phase!=="ASKING") return;

  const order = computeOrderFromRoom(room, playersCache);
  const turnNum = Number(room.turnNum||0);
  const askerUid = order.length ? order[turnNum % order.length] : null;
  if(askerUid !== user.uid) return;

  await updateDoc(roomRef, nextState(room));
});

/* Voting UI */
function renderChoices(q, order){
  const isAsker = q.askerUid === user.uid;
  const alreadyAnswered = (q.answeredUids || []).includes(user.uid);
  const isReveal = !!q.reveal;

  // counts + pending names
  const totalVoters = order.filter(uid=>uid!==q.askerUid);
  const answered = (q.answeredUids || []);
  const pendingUids = totalVoters.filter(uid=>!answered.includes(uid));
  const pendingNames = pendingUids.map(uid=>getPlayerName(uid)).filter(Boolean);

  // top status line
  if(isReveal){
    voteSub.textContent = "الإجابة الصحيحة";
    voteMsg.textContent = "الراوند الجاي بعد ثواني...";
  }else{
    voteSub.textContent = `Voted ${answered.length}/${totalVoters.length}`;
    voteMsg.textContent = pendingNames.length ? `Waiting: ${pendingNames.join(", ")}` : "Everyone voted!";
  }

  choices.innerHTML = "";

  // get my chosen (for reveal)
  const me = getMe();
  const myChosenIdx = (me?.lastAnswerQid === q.qid) ? me?.lastAnswerIdx : null;

  q.options.forEach((opt,idx)=>{
    const b=document.createElement("button");
    b.className="btn choiceBtn";
    b.textContent=opt;

    if(isReveal){
      b.disabled = true;

      // correct is green
      if(idx === q.correctIndex) b.classList.add("choiceCorrect");

      // my wrong choice (optional red)
      if(myChosenIdx !== null && idx === myChosenIdx && myChosenIdx !== q.correctIndex){
        b.classList.add("choiceWrong");
      }

      // dim others
      if(idx !== q.correctIndex && idx !== myChosenIdx){
        b.classList.add("choiceDim");
      }
    }else{
      // lock voting if already answered or asker
      b.disabled = alreadyAnswered || isAsker;

      // show selected
      if(myChosenIdx !== null && idx === myChosenIdx){
        b.classList.add("choiceSelected");
      }

      b.addEventListener("click", async ()=>{
        await submitAnswer(idx);
      });
    }

    choices.appendChild(b);
  });

  // helper text
  if(isAsker && !isReveal){
    // asker can't vote
    voteMsg.textContent = pendingNames.length ? `Waiting: ${pendingNames.join(", ")}` : "Everyone voted!";
  } else if(alreadyAnswered && !isReveal){
    // already voted
    // keep voteMsg as waiting list
  }

  // if all voted -> asker settles + reveals
  const allAnswered = pendingUids.length === 0;
  if(allAnswered && user.uid===q.askerUid && !isReveal){
    settleAndReveal(order, true);
  }

  // refresh players coloring
  if(roomCache){
    renderPlayers(playersCache, roomCache.ownerUid, roomCache.ownerName);
  }
}

async function submitAnswer(chosenIdx){
  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  if(room.phase!=="VOTING" || !room.currentQuestion) return;
  const q=room.currentQuestion;

  if(q.askerUid===user.uid) return;
  if((q.answeredUids||[]).includes(user.uid)) return;
  if(q.reveal) return;

  const playerRef=doc(db,"rooms",currentRoomCode,"players",user.uid);
  await updateDoc(playerRef,{ lastAnswerQid:q.qid, lastAnswerIdx:chosenIdx });
  await updateDoc(roomRef,{ "currentQuestion.answeredUids": arrayUnion(user.uid) });

  // instant ui
  voteSub.textContent="تم تسجيل إجابتك";
}

/**
 * ✅ Settle + Reveal (3 sec) + NEW scoring system (A)
 * - correct voters +1
 * - wrong/no answer 0
 * - asker + wrongCount
 */
async function settleAndReveal(order, allowPartial=false){
  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  if(room.phase!=="VOTING" || !room.currentQuestion) return;
  const q=room.currentQuestion;

  // only asker settles
  if(q.askerUid !== user.uid) return;

  // don't settle twice
  if(q.settled) return;

  const playersSnap=await getDocs(query(collection(db,"rooms",currentRoomCode,"players"),orderBy("joinedAtMs","asc")));
  const plist=playersSnap.docs.map(d=>({uid:d.id, ...d.data()}));

  const byUid = new Map(plist.map(p=>[p.uid,p]));
  const participants = order.map(uid=>byUid.get(uid)).filter(Boolean);

  let wrongCount = 0;

  const batch=writeBatch(db);

  // score voters
  participants.forEach(p=>{
    if(p.uid === q.askerUid) return;

    const answered = (p.lastAnswerQid === q.qid);
    const correct = answered && (p.lastAnswerIdx === q.correctIndex);

    if(correct){
      batch.update(doc(db,"rooms",currentRoomCode,"players",p.uid),{ score:(p.score||0)+1 });
    }else{
      // wrong or no answer => 0
      wrongCount += 1;
    }
  });

  // score asker: + number wrong
  const asker = byUid.get(q.askerUid);
  batch.update(doc(db,"rooms",currentRoomCode,"players",q.askerUid),{ score:(asker?.score||0)+wrongCount });

  // switch to reveal mode for 3 seconds
  batch.update(roomRef,{
    "currentQuestion.settled": true,
    "currentQuestion.reveal": true,
    phaseEndsAtMs: nowMs() + 3000
  });

  await batch.commit();
}

/* Next state */
function nextState(room){
  const rounds=clamp(Number(room.roundsRequested||1),1,20);
  const order=Array.isArray(room.playerOrder)?room.playerOrder:[];
  const totalTurns=Number(room.totalTurns || (order.length*rounds));
  const turnNum=Number(room.turnNum||0);
  const nextTurn=turnNum+1;

  const askTimeSec=clamp(Number(room.askTimeSec||30),10,120);

  if(nextTurn >= totalTurns){
    return { status:"FINISHED", phase:"ASKING", turnNum: nextTurn, currentQuestion:null, phaseEndsAtMs:null };
  }
  return { phase:"ASKING", turnNum: nextTurn, currentQuestion:null, phaseEndsAtMs: nowMs() + askTimeSec*1000 };
}

/* Timer tick */
async function tick(){
  if(!currentRoomCode || !roomCache) return;

  const room = roomCache;
  if(room.status!=="STARTED"){
    timerTop.textContent="—";
    return;
  }

  const endsAt = room.phaseEndsAtMs;
  if(!endsAt){
    timerTop.textContent="—";
    return;
  }

  const left = endsAt - nowMs();
  timerTop.textContent = fmtSecLeft(left);

  const secLeft = Math.max(0, Math.ceil(left/1000));

  // timer sound (last 5 seconds) only in VOTING and not reveal
  if(room.phase==="VOTING" && room.currentQuestion && !room.currentQuestion.reveal){
    if(secLeft <= 5 && secLeft >= 1){
      if(lastTickSecond !== secLeft){
        lastTickSecond = secLeft;
        playTick();
      }
    }
  }

  // time up sound once
  if(left <= 0 && room.phase==="VOTING" && room.currentQuestion){
    const qid = room.currentQuestion.qid || "x";
    if(lastEndBeepQid !== qid && !room.currentQuestion.reveal){
      lastEndBeepQid = qid;
      playTimeUp();
    }
  }

  if(left > 0) return;

  const roomRef=doc(db,"rooms",currentRoomCode);
  const order = computeOrderFromRoom(room, playersCache);
  const rounds = clamp(Number(room.roundsRequested||1),1,20);
  const totalTurns = Number(room.totalTurns || (order.length*rounds));
  const turnNum = Number(room.turnNum||0);

  if(turnNum >= totalTurns) return;

  const askerUid = order.length ? order[turnNum % order.length] : null;
  if(!askerUid) return;

  // ASKING timeout: auto-skip by asker
  if(room.phase==="ASKING"){
    if(askerUid === user.uid){
      await updateDoc(roomRef, nextState(room));
    }
    return;
  }

  // VOTING timeout:
  if(room.phase==="VOTING"){
    const q = room.currentQuestion;
    if(!q) return;

    // if reveal finished -> advance
    if(q.reveal){
      if(q.askerUid === user.uid){
        await updateDoc(roomRef, nextState(room));
      }
      return;
    }

    // if voting finished by timeout -> settle + reveal
    if(q.askerUid === user.uid){
      await settleAndReveal(order, true);
    }
    return;
  }
}
