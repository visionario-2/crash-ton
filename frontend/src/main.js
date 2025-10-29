// =======================
// Crash Frontend – WS sync (crash_ws1)
// =======================
window.__CRASH_VERSION__ = "crash_ws1";
console.log("Crash Frontend:", window.__CRASH_VERSION__);

// ===== CONFIG (vem do _config.js) =====
const CONF = window.CONFIG || {};
const API_BASE = (CONF.API_BASE || "").replace(/\/+$/, ""); // sem barra final

// ===== Helpers TG ID =====
function getTelegramId() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const uid = tg?.initDataUnsafe?.user?.id;
  if (uid) {
    localStorage.setItem("tg_id", String(uid));
    return String(uid);
  }
  // fallback p/ testes no navegador
  const saved = localStorage.getItem("tg_id");
  if (saved) return saved;
  const gen = "guest_" + Math.floor(Math.random() * 1e9);
  localStorage.setItem("tg_id", gen);
  return gen;
}
const TG_ID = getTelegramId();

// ===== ESTADO/UI =====
const $ = (id) => document.getElementById(id);
const elBig = $("bigMult");
const elPhase = $("phaseTxt");
const elCrashTxt = $("crashTxt");
const elBal = $("balance");
const elBetAmount = $("betAmount");
const elAutoCash = $("autoCash");
const elBetBtn = $("betBtn");
const elCashoutBtn = $("cashoutBtn");
const elHistory = $("trendsBar");        // reaproveitamos como “histórico”
const elPhaserRoot = $("phaser-root");

const state = {
  phase: "cooldown",       // cooldown | running | crashed
  currentX: 1.0,
  maxX: 100.0,
  hasBet: false,
  betAmount: 100,
  autoCash: null,
  balance: 0,

  // dados do round (vindos do servidor)
  roundStartTs: 0,         // epoch seconds
  crashTarget: 2.0,
};

const fmt = {
  mult: (x) => `${x.toFixed(2)}×`,
  num:  (n) => (Number.isFinite(n) ? n.toLocaleString("pt-BR") : n),
  s:    (t) => `${t|0}s`,
};

function setPhase(p, left=null) {
  state.phase = p;
  elPhase.textContent = left == null ? p : `${p} (${fmt.s(left)})`;
}
function setBalance(v) { state.balance = v; elBal.textContent = fmt.num(v); }

// ===== Layout / MiniApp sizing =====
function currentVH(){
  const tg = window.Telegram && window.Telegram.WebApp;
  return tg?.viewportHeight ? tg.viewportHeight : window.innerHeight;
}
function computeGraphHeight(){
  const vh = currentVH();
  const reserved = 240; // topbar + histórico + controles + status
  const h = Math.max(320, Math.min(540, vh - reserved));
  document.documentElement.style.setProperty("--graph-h", `${Math.round(h)}px`);
}
computeGraphHeight();
window.addEventListener("resize", computeGraphHeight);
if (window.Telegram?.WebApp) {
  Telegram.WebApp.onEvent("viewportChanged", computeGraphHeight);
  Telegram.WebApp.expand?.();
}

// ===== API (usa API_BASE do _config.js) =====
async function fetchBalance() {
  try {
    const r = await fetch(`${API_BASE}/balance/${encodeURIComponent(TG_ID)}`);
    const j = await r.json();
    setBalance(Number(j.balance_ton || 0));
  } catch {
    setBalance(0);
  }
}
async function postBet(amount, autoCash){
  const r = await fetch(`${API_BASE}/bet`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ tg_id: TG_ID, amount, auto_cash: autoCash })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function postCashout(){
  const r = await fetch(`${API_BASE}/cashout`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ tg_id: TG_ID })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ===== Phaser – só desenha (x vem do servidor) =====
let phaserApp, gfx, labels = [];
class Scene extends Phaser.Scene{
  create(){
    gfx = this.add.graphics({ lineStyle: { width: 1, color: 0x233066, alpha: 1 } });
    this.time.addEvent({ delay: 33, loop:true, callback:()=>this.tick() });
    this.scale.on('resize', () => this.drawGrid(), this);
    this.drawGrid();
  }
  drawGrid(){
    const W = elPhaserRoot.clientWidth, H = elPhaserRoot.clientHeight;
    gfx.clear();
    gfx.fillStyle(0x0b1230, 1).fillRect(0,0,W,H);

    const cx = Math.max(70, Math.floor(W*0.08));
    const cy = H - 36;
    const rMax = Math.min(W - (cx+40), H - 70);

    for(let i=1;i<=8;i++){
      const rr = (rMax/8)*i;
      gfx.lineStyle(1, 0x233066, 1);
      gfx.strokeCircle(cx,cy, rr);
    }

    labels.forEach(t=>t.destroy()); labels=[];
    for(let i=0;i<=10;i++){
      const ang = Phaser.Math.DegToRad( -15 + (i* (210/10)) );
      const x1 = cx + Math.cos(ang)*(rMax-6);
      const y1 = cy + Math.sin(ang)*(rMax-6);
      const x2 = cx + Math.cos(ang)*(rMax);
      const y2 = cy + Math.sin(ang)*(rMax);
      gfx.lineStyle(2, 0x2f3d7a, 1).beginPath().moveTo(x1,y1).lineTo(x2,y2).strokePath();

      const rx = cx + Math.cos(ang)*(rMax+14);
      const ry = cy + Math.sin(ang)*(rMax+14);
      const txt = this.add.text(rx, ry, i===0? "1x": `${i}x`, {fontSize:"12px", color:"#8aa0c5"}).setOrigin(0.5);
      labels.push(txt);
    }
    gfx.lineStyle(1, 0x1f2a5a, 1).beginPath().moveTo(cx,cy).lineTo(W-20, cy).strokePath();
  }
  tick(){
    const W = elPhaserRoot.clientWidth, H = elPhaserRoot.clientHeight;
    if(!W || !H) return;
    const cx = Math.max(70, Math.floor(W*0.08));
    const cy = H - 36;
    const rMax = Math.min(W - (cx+40), H - 70);

    const color = (state.phase==="crashed")? 0xff4d5a : 0x5c7cff;
    gfx.lineStyle(4, color, 1).beginPath();

    const x = Math.min(state.currentX, 10);   // layout mostra até 10x
    const t = (x-1)/9;
    const steps = 200;
    for(let i=0;i<=steps;i++){
      const tt = t*(i/steps);
      const a = Phaser.Math.DegToRad( -15 + (tt*210) );
      const rr = rMax*tt;
      const px = cx + Math.cos(a)*rr;
      const py = cy + Math.sin(a)*rr;
      if(i===0) gfx.moveTo(px,py); else gfx.lineTo(px,py);
    }
    gfx.strokePath();

    elBig.textContent = fmt.mult(state.currentX);
  }
}
function bootPhaser(){
  if(phaserApp) return;
  phaserApp = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "phaser-root",
    backgroundColor: "#0b1230",
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [Scene],
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
}
bootPhaser();

// ===== Histórico (10 últimas) =====
let history = []; // números
function cls(x){
  if(x < 2)  return "low";
  if(x < 4)  return "mid";
  if(x < 10) return "high";
  return "insane";
}
function renderHistory(){
  if(!elHistory) return;
  elHistory.innerHTML = "";
  history.forEach(v=>{
    const pill = document.createElement("div");
    pill.className = `hist-pill ${cls(v)}`;
    pill.textContent = `${v.toFixed(2)}×`;
    elHistory.appendChild(pill);
  });
}
function pushHistory(x){
  history.push(x);
  if(history.length>10) history.shift();
  renderHistory();
}

// ===== WebSocket (sincroniza com o servidor) =====
let ws;
function wsUrl(){
  const base = API_BASE || location.origin;
  // https -> wss, http -> ws
  return base.replace(/^http/i, "ws") + "/ws";
}
function connectWS(){
  const url = wsUrl();
  ws = new WebSocket(url);
  ws.onopen = ()=> console.log("WS connected:", url);
  ws.onclose = ()=> { console.log("WS closed. Reconnecting..."); setTimeout(connectWS, 1500); };
  ws.onmessage = (ev)=>{
    try{
      const msg = JSON.parse(ev.data);
      if(msg.type === "phase"){
        if(msg.phase === "cooldown"){
          setPhase("cooldown");
          // alguns envios vêm com cooldown_until; outros, o loop manda "cooldown" separado
          if (msg.cooldown_until) {
            updateCooldown(msg.cooldown_until - (Date.now()/1000));
          }
        }else if(msg.phase === "running"){
          state.roundStartTs = msg.round_start_ts || state.roundStartTs;
          state.crashTarget  = msg.crash_target   || state.crashTarget;
          setPhase("running");
        }else if(msg.phase === "crashed"){
          setPhase("crashed");
        }
      }else if(msg.type === "cooldown"){
        updateCooldown(msg.left);
      }else if(msg.type === "tick"){
        state.currentX = Math.min(state.maxX, Number(msg.x || 1));
      }else if(msg.type === "crash"){
        state.currentX = Math.min(state.maxX, Number(msg.x || state.currentX));
        setPhase("crashed");
        elCrashTxt.textContent = fmt.mult(state.currentX);
        pushHistory(state.currentX);
        state.hasBet = false;
        elCashoutBtn.disabled = true;
      }
    }catch(e){
      console.warn("WS message parse error:", e, ev.data);
    }
  };
}
function updateCooldown(left){
  if (left == null) return;
  const l = Math.max(0, Math.round(left));
  setPhase("cooldown", l);
}

// ===== Ações de UI =====
document.querySelectorAll(".quick button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const a = Number(elBetAmount.value || 0) || 0;
    if(btn.dataset.q==="min")  elBetAmount.value = 10;
    if(btn.dataset.q==="half") elBetAmount.value = Math.max(10, Math.floor(a/2));
    if(btn.dataset.q==="2x")   elBetAmount.value = Math.min(100000, a*2 || 20);
    if(btn.dataset.q==="max")  elBetAmount.value = 100000;
  });
});

elBetBtn.addEventListener("click", async ()=>{
  const amount = Math.max(10, Number(elBetAmount.value||0)|0);
  const auto = Number(elAutoCash.value||0);
  state.betAmount = amount;
  state.autoCash  = Number.isFinite(auto)&&auto>=1.01 ? Math.min(auto, state.maxX) : null;

  try{
    const res = await postBet(amount, state.autoCash);
    setBalance(res.balance_ton ?? state.balance);
    state.hasBet = true;
    // Aposta só é aceita em cooldown (o backend já valida)
  }catch(e){
    console.warn("bet failed:", e);
  }
});

$("cashoutBtn").addEventListener("click", async ()=>{
  if(state.phase!=="running" || !state.hasBet) return;
  try{
    elCashoutBtn.disabled = true;
    const res = await postCashout();
    setBalance(res.balance_ton ?? state.balance);
    state.hasBet = false;
  }catch(e){
    elCashoutBtn.disabled = false;
    console.warn("cashout failed:", e);
  }
});

// ===== Boot =====
function init(){
  fetchBalance();
  computeGraphHeight();
  renderHistory();
  connectWS();
}
init();
