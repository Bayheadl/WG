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
}

function startTick(){
  stopTick();
  tickTimer = setInterval(() => tick(), 500);
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

// ✅ حل مشكلة الأونر: نسمح بالأونر بالـ UID أو بالاسم
function isOwner(room){
  const me = getMe();
  const myName = (me?.name || "").trim();
  const ownerName = (room?.ownerName || "").trim();
  return (room?.ownerUid === user?.uid) || (ownerName && myName && ownerName === myName);
}

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

  sortedJoin.forEach(p=>{
    const row=document.createElement("div");
    row.className="playerRow";

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

  leader.innerHTML="";
  sorted.forEach((p,i)=>{
    const row=document.createElement("div");
    row.className="leaderRow";
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
    ownerName: name, // ✅ مهم: نخزن اسم الأونر لحل مشكلة UID
    createdAt: serverTimestamp(),

    status: "WAITING",
    phase: "ASKING",
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

  // ✅ شرط الأونر (UID أو الاسم)
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

  // ✅ لو الروم قديم وما فيه ownerName، نحاول نحفظه تلقائيًا
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
      // ✅ نعرض صندوق البدء للأونر بالاسم أو UID
      if(isOwner(room)){
        startBox.classList.remove("hidden");
        const allReady = isAllReady(playersCache);
        startBtn.disabled = !allReady;
        startMsg.textContent = allReady ? "الكل جاهز. تقدر تبدأ." : "انتظر لين الجميع يصير Ready.";
      }
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

  await updateDoc(roomRef,{
    phase:"VOTING",
    qCounter:(room.qCounter||0)+1,
    currentQuestion:{
      qid,
      askerUid:user.uid,
      text,
      options,
      correctIndex:cidx,
      answeredUids:[]
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
  const alreadyAnswered = (q.answeredUids || []).includes(user.uid);
  const isAsker = q.askerUid === user.uid;

  choices.innerHTML = "";
  voteMsg.textContent = "";

  q.options.forEach((opt,idx)=>{
    const b=document.createElement("button");
    b.className="btn choiceBtn";
    b.textContent=opt;

    b.disabled = alreadyAnswered || isAsker;

    b.addEventListener("click", async ()=>{
      await submitAnswer(idx);
    });

    choices.appendChild(b);
  });

  if(isAsker){
    voteSub.textContent="انتظر إجابات الباقين";
  } else if(alreadyAnswered){
    voteSub.textContent="تم تسجيل إجابتك";
    voteMsg.textContent="انتظر باقي اللاعبين...";
  } else {
    voteSub.textContent="اختر إجابتك";
  }

  const need = order.filter(uid=>uid!==q.askerUid);
  const answered = q.answeredUids || [];
  const allAnswered = need.every(uid=>answered.includes(uid));
  if(allAnswered && user.uid===q.askerUid){
    settleAndAdvance(order, true);
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

  const playerRef=doc(db,"rooms",currentRoomCode,"players",user.uid);
  await updateDoc(playerRef,{ lastAnswerQid:q.qid, lastAnswerIdx:chosenIdx });
  await updateDoc(roomRef,{ "currentQuestion.answeredUids": arrayUnion(user.uid) });

  voteSub.textContent="تم تسجيل إجابتك";
  voteMsg.textContent="انتظر باقي اللاعبين...";
}

/* Settle + advance */
async function settleAndAdvance(order, allowPartial=false){
  const roomRef=doc(db,"rooms",currentRoomCode);
  const rs=await getDoc(roomRef);
  if(!rs.exists()) return;
  const room=rs.data();

  if(room.phase!=="VOTING" || !room.currentQuestion) return;
  const q=room.currentQuestion;

  if(q.askerUid !== user.uid) return;

  const playersSnap=await getDocs(query(collection(db,"rooms",currentRoomCode,"players"),orderBy("joinedAtMs","asc")));
  const plist=playersSnap.docs.map(d=>({uid:d.id, ...d.data()}));

  const batch=writeBatch(db);
  const participants = order.map(uid=> plist.find(p=>p.uid===uid)).filter(Boolean);

  let wrongCount=0;
  let allCorrect=true;

  participants.forEach(p=>{
    if(p.uid===q.askerUid) return;

    const answered = (p.lastAnswerQid === q.qid);
    const correct = answered && (p.lastAnswerIdx === q.correctIndex);

    if(!correct){
      allCorrect=false;
      wrongCount += 1;
    }
  });

  if(allCorrect){
    participants.forEach(p=>{
      if(p.uid===q.askerUid) return;
      batch.update(doc(db,"rooms",currentRoomCode,"players",p.uid),{ score:(p.score||0)+1 });
    });
  }else{
    const asker = plist.find(p=>p.uid===q.askerUid);
    batch.update(doc(db,"rooms",currentRoomCode,"players",q.askerUid),{ score:(asker?.score||0)+wrongCount });
  }

  batch.update(roomRef, nextState(room));
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

  if(left > 0) return;

  const roomRef=doc(db,"rooms",currentRoomCode);
  const order = computeOrderFromRoom(room, playersCache);
  const rounds = clamp(Number(room.roundsRequested||1),1,20);
  const totalTurns = Number(room.totalTurns || (order.length*rounds));
  const turnNum = Number(room.turnNum||0);

  if(turnNum >= totalTurns) return;

  const askerUid = order.length ? order[turnNum % order.length] : null;
  if(!askerUid) return;

  if(room.phase==="ASKING"){
    if(askerUid === user.uid){
      await updateDoc(roomRef, nextState(room));
    }
    return;
  }

  if(room.phase==="VOTING"){
    const q = room.currentQuestion;
    if(!q) return;
    if(q.askerUid === user.uid){
      await settleAndAdvance(order, true);
    }
    return;
  }
}
