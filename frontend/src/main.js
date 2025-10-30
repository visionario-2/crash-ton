// =======================
// Crash Frontend – WS sync (crash_ws3)
// =======================
window.__CRASH_VERSION__ = "crash_ws3";
console.log("Crash Frontend:", window.__CRASH_VERSION__);

// ===== CONFIG (vem do _config.js) =====
const CONF = window.CONFIG || {};
const API_BASE = (CONF.API_BASE || "").replace(/\/+$/, "");

// ===== Helpers TG ID =====
function getTelegramId() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const uid = tg?.initDataUnsafe?.user?.id;
  if (uid) {
    localStorage.setItem("tg_id", String(uid));
    return String(uid);
  }
  const saved = localStorage.getItem("tg_id");
  if (saved) return saved;
  const gen = "guest_" + Math.floor(Math.random() * 1e9);
  localStorage.setItem("tg_id", gen);
  return gen;
}
const TG_ID = getTelegramId();

// ===== ESTADO / UI =====
const $ = (id) => document.getElementById(id);
const elBig        = $("bigMult");
const elPhase      = $("phaseTxt");
const elCrashTxt   = $("crashTxt");
const elBal        = $("balance");
const elBetAmount  = $("betAmount");
const elAutoCash   = $("autoCash");
const elBetBtn     = $("betBtn");
const elCashoutBtn = $("cashoutBtn");
const elHistory    = $("trendsBar");
const elPhaserRoot = $("phaser-root");

const state = {
  phase: "cooldown",      // cooldown | running | crashed
  currentX: 1.0,
  maxX: 100.0,
  hasBet: false,
  betAmount: 100,
  autoCash: null,
  balance: 0,

  // vindos do servidor
  roundStartTs: 0,        // epoch seconds
  crashTarget: 2.0,
};

const fmt = {
  mult: (x) => `${x.toFixed(2)}×`,
  num : (n) => (Number.isFinite(n) ? n.toLocaleString("pt-BR") : n),
  s   : (t) => `${t|0}s`,
};

function setPhase(p, left=null) {
  state.phase = p;
  // pill embaixo (statusbar)
  elPhase.textContent = left == null ? p : `${p} (${fmt.s(left)})`;

  // texto do centro
  elBig.classList.remove("waiting","crashed");
  if (p === "cooldown") {
    elBig.classList.add("waiting");
    elBig.textContent = left==null ? "Aguardando" : `Aguardando ${left|0}s`;
  } else if (p === "crashed") {
    elBig.classList.add("crashed");
    elBig.textContent = "CRASHED";
  }
}
function updateCooldown(left){
  const l = Math.max(0, Math.round(left));
  setPhase("cooldown", l);
}
function setBalance(v){ state.balance=v; elBal.textContent=fmt.num(v); }

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

// ===== API =====
async function fetchBalance() {
  try {
    const r = await fetch(`${API_BASE}/balance/${encodeURIComponent(TG_ID)}`);
    const j = await r.json();
    setBalance(Number(j.balance_ton || 0));
  } catch { setBalance(0); }
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

// ===== Phaser – desenha a “curva central” =====
let phaserApp, gfx;
class Scene extends Phaser.Scene{
  create(){
    gfx = this.add.graphics();
    this.time.addEvent({ delay: 33, loop:true, callback:()=>this.tick() });
    this.scale.on('resize', () => {}, this); // redesenho total já é feito no tick
  }

  tick(){
    const W = elPhaserRoot.clientWidth, H = elPhaserRoot.clientHeight;
    if(!W || !H) return;

    // limpa tudo a cada frame (fundo + grid + curva)
    gfx.clear();
    // fundo
    gfx.fillStyle(0x0b1230, 1).fillRect(0,0,W,H);

    // GRID estilo aviator
    const grid1 = 0x1c264f, grid2 = 0x243065;
    const baseY = Math.floor(H*0.78);
    const leftX = Math.floor(W*0.08), rightX = Math.floor(W*0.92);

    for(let i=0;i<6;i++){
      const yy = baseY - i*(H*0.10);
      gfx.lineStyle(1, grid1, 1).beginPath().moveTo(leftX, yy).lineTo(rightX, yy).strokePath();
    }
    for(let i=0;i<8;i++){
      const xx = leftX + i*(W*0.10);
      gfx.lineStyle(1, grid2, 1).beginPath().moveTo(xx, baseY).lineTo(xx+Math.floor(W*0.12), baseY - Math.floor(H*0.18)).strokePath();
    }

    // curva central (cometa)
    const x0 = Math.floor(W*0.12),     y0 = baseY;             // início (baixo/esq)
    const x1 = Math.floor(W*0.88),     y1 = Math.floor(H*0.18);// topo (alto/dir)
    const xVis = Math.min(state.currentX, 10);
    const p = Math.max(0, Math.min(1, (xVis - 1) / 9));        // 0..1 de 1x a 10x
    const ease = (t)=> 1 - Math.pow(1-t, 3);                   // easeOutCubic
    const col  = (state.phase==="crashed") ? 0xff4d5a : 0x9fb6ff;

    gfx.lineStyle(4, col, 1).beginPath();
    const steps = 240;
    for(let i=0;i<=steps;i++){
      const t = ease(p * (i/steps));
      const xx = x0 + (x1 - x0) * t;
      const yy = y0 - (y0 - y1) * t;
      if(i===0) gfx.moveTo(xx,yy); else gfx.lineTo(xx,yy);
    }
    gfx.strokePath();

    // “nariz” do cometa
    const xx = x0 + (x1 - x0) * ease(p);
    const yy = y0 - (y0 - y1) * ease(p);
    gfx.fillStyle(col, 1).fillCircle(xx, yy, 6);

    // texto grande (DOM) – atualizado aqui para garantir sincronismo
    if (state.phase === "running") {
      elBig.classList.remove("waiting","crashed");
      elBig.textContent = fmt.mult(state.currentX);
    } else if (state.phase === "crashed") {
      elBig.classList.add("crashed");
      elBig.textContent = "CRASHED";
    }
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
let history = [];
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
  return base.replace(/^http/i, "ws") + "/ws"; // https->wss
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
          if (msg.cooldown_until) updateCooldown(msg.cooldown_until - (Date.now()/1000));
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
        if (state.phase === "running") {
          elBig.classList.remove("waiting","crashed");
          elBig.textContent = fmt.mult(state.currentX);
        }
      }else if(msg.type === "crash"){
        state.currentX = Math.min(state.maxX, Number(msg.x || state.currentX));
        setPhase("crashed");
        elCrashTxt.textContent = fmt.mult(state.currentX); // “Crash desta rodada”
        pushHistory(state.currentX);
        state.hasBet = false;
        elCashoutBtn.disabled = true;
      }
    }catch(e){
      console.warn("WS parse error:", e, ev.data);
    }
  };
}
function updateCooldown(left){
  const l = Math.max(0, Math.round(left));
  setPhase("cooldown", l);
}

// ===== Ações de UI =====
document.querySelectorAll(".quick button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const a = Number(elBetAmount.value||0) || 0;
    if(btn.dataset.q==="min")  elBetAmount.value = 10;
    if(btn.dataset.q==="half") elBetAmount.value = Math.max(10, Math.floor(a/2));
    if(btn.dataset.q==="2x")   elBetAmount.value = Math.min(100000, a*2 || 20);
    if(btn.dataset.q==="max")  elBetAmount.value = 100000;
  });
});

elBetBtn.addEventListener("click", async ()=>{
  const amount = Math.max(10, Number(elBetAmount.value||0)|0);
  const auto   = Number(elAutoCash.value||0);
  state.betAmount = amount;
  state.autoCash  = Number.isFinite(auto)&&auto>=1.01 ? Math.min(auto, state.maxX) : null;

  try{
    const res = await postBet(amount, state.autoCash);
    setBalance(res.balance_ton ?? state.balance);
    state.hasBet = true;
    // aposta válida só em cooldown (backend já valida)
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
