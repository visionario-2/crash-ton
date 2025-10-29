// =======================
// Crash Frontend v008
// =======================
window.__CRASH_VERSION__ = "008";
console.log("Crash Frontend v" + window.__CRASH_VERSION__);

// ===== CONFIG =====
const API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || "/api";

// ===== ESTADO =====
// Agora com ciclo completo e parâmetros de velocidade/cooldown:
const state = {
  phase: "cooldown",          // cooldown | running | crashed
  currentX: 1.0,
  crashedAt: null,
  roundId: null,
  hasBet: false,
  betAmount: 100,
  autoCash: null,
  balance: 0,
  minBet: 10,
  maxBet: 100000,

  // --- curvas e limites ---
  // 1→2x em ~10s:
  a: Math.log(2) / 10,
  // 2→100x em ~20s (aceleração):
  b: Math.log(100 / 2) / 20,
  maxX: 100.0,

  // --- rodada ---
  cooldownSec: 20,
};

let crashTarget = 2.0;           // alvo de crash da rodada atual
let roundRAF = 0;                // requestAnimationFrame id
let cooldownTimer = 0;           // setInterval id
let roundStartMs = 0;            // timestamp ms quando começou o running

// ===== UI REFS =====
const $ = (id)=>document.getElementById(id);
const elBig = $("bigMult");
const elPhase = $("phaseTxt");
const elCrashTxt = $("crashTxt");
const elBal = $("balance");
const elBetAmount = $("betAmount");
const elAutoCash = $("autoCash");
const elBetBtn = $("betBtn");
const elCashoutBtn = $("cashoutBtn");
const elTrendsBar = $("trendsBar");            // vamos usar isto como HISTÓRICO
const elPhaserRoot = $("phaser-root");

// ===== FORMAT =====
const fmt = {
  mult: (x)=> `${x.toFixed(2)}×`,
  num : (n)=> (Number.isFinite(n)? n.toLocaleString("pt-BR"): n),
  s   : (t)=> `${t|0}s`,
};

function setPhase(p, left=null){
  state.phase = p;
  if(left != null){
    // se não existir um span dedicado ao cooldown, mostra junto
    elPhase.textContent = `${p} (${fmt.s(left)})`;
  }else{
    elPhase.textContent = p;
  }
}
function setBalance(v){ state.balance=v; elBal.textContent=fmt.num(v); }

// ===== TELEGRAM VIEWPORT / RESIZE =====
function currentVH(){
  const tg = window.Telegram && window.Telegram.WebApp;
  return (tg && tg.viewportHeight) ? tg.viewportHeight : window.innerHeight;
}
function computeGraphHeight(){
  const vh = currentVH();
  const reserved = 240; // cabeçalho + trends + controles + status
  const h = Math.max(320, Math.min(540, vh - reserved));
  document.documentElement.style.setProperty("--graph-h", `${Math.round(h)}px`);
}
computeGraphHeight();
window.addEventListener("resize", computeGraphHeight);
if(window.Telegram && window.Telegram.WebApp){
  Telegram.WebApp.onEvent("viewportChanged", computeGraphHeight);
  Telegram.WebApp.expand && Telegram.WebApp.expand();
}

// ===== BACKEND STUBS (mantidos) =====
async function fetchBalance(){
  try{
    const r = await fetch(`${API}/balance`);
    const j = await r.json();
    setBalance(j.balance ?? 0);
  }catch{ setBalance(0); }
}
async function postBet(amount, autoCash){
  const r = await fetch(`${API}/bet`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ amount, autoCash })
  });
  if(!r.ok) throw new Error("Falha na aposta");
  return r.json();
}
async function postCashout(){
  const r = await fetch(`${API}/cashout`, { method:"POST" });
  if(!r.ok) throw new Error("Falha no cashout");
  return r.json();
}

// ===== PHASER – cena com grid radial + curva =====
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

    // desenha até 10x (layout), embora o teto real seja 100x
    const x = Math.min(state.currentX, 10);
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

// ===== HISTÓRICO (usa #trendsBar) =====
let history = []; // guarda somente números
function cls(x){
  if(x < 2)  return "low";
  if(x < 4)  return "mid";
  if(x < 10) return "high";
  return "insane";
}
function renderHistory(){
  if(!elTrendsBar) return;
  elTrendsBar.innerHTML = "";
  history.forEach(v=>{
    const pill = document.createElement("div");
    pill.className = `hist-pill ${cls(v)}`;
    pill.textContent = `${v.toFixed(2)}×`;
    elTrendsBar.appendChild(pill);
  });
}
function pushHistory(x){
  history.push(x);
  if(history.length>10) history.shift();
  renderHistory();
}

// ===== Curva (tempo → multiplicador) =====
function xFromTimeSec(t){
  if(t <= 10) return Math.min(state.maxX, Math.exp(state.a * t));           // 1→2x ~10s
  return Math.min(state.maxX, 2 * Math.exp(state.b * (t - 10)));            // acelera até 100x
}
function pickCrashTarget(){
  // distribuição com muitas quedas baixas e algumas altas
  const r = Math.random();
  if(r < 0.70) return 1.01 + Math.random()*(4-1.01);
  if(r < 0.95) return 4 + Math.random()*(10-4);
  return 10 + Math.random()*(100-10);
}

// ===== Ciclo da rodada (client-side) =====
function clearTimers(){
  if(roundRAF){ cancelAnimationFrame(roundRAF); roundRAF=0; }
  if(cooldownTimer){ clearInterval(cooldownTimer); cooldownTimer=0; }
}

function startCooldown(sec = state.cooldownSec){
  clearTimers();
  state.currentX = 1.0;
  elCrashTxt.textContent = "—";
  elCashoutBtn.disabled = true;
  elBetBtn.disabled = false;

  let left = sec;
  setPhase("cooldown", left);
  cooldownTimer = setInterval(()=>{
    left = Math.max(0, left - 1);
    setPhase("cooldown", left);
    if(left <= 0){
      clearInterval(cooldownTimer); cooldownTimer=0;
      crashTarget = pickCrashTarget();
      startRunning();
    }
  }, 1000);
}

function startRunning(){
  clearTimers();
  setPhase("running");
  roundStartMs = performance.now();

  const step = ()=>{
    if(state.phase !== "running") return;
    const t = (performance.now() - roundStartMs)/1000; // em segundos
    state.currentX = xFromTimeSec(t);

    // auto cashout
    if(state.hasBet && state.autoCash && state.currentX >= state.autoCash){
      doCashout("auto");
    }

    // chegou no crash?
    if(state.currentX >= crashTarget){
      setPhase("crashed");
      state.crashedAt = state.currentX;
      elCrashTxt.textContent = fmt.mult(state.currentX);
      if(state.hasBet) elCashoutBtn.disabled = true;
      pushHistory(state.currentX);
      state.hasBet = false;
      setTimeout(()=> startCooldown(state.cooldownSec), 1000);
      return;
    }
    roundRAF = requestAnimationFrame(step);
  };
  roundRAF = requestAnimationFrame(step);
}

// ===== AÇÕES =====
document.querySelectorAll(".quick button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const a = Number(elBetAmount.value||state.minBet);
    if(btn.dataset.q==="min")  elBetAmount.value = state.minBet;
    if(btn.dataset.q==="half") elBetAmount.value = Math.max(state.minBet, Math.floor(a/2));
    if(btn.dataset.q==="2x")   elBetAmount.value = Math.min(state.maxBet, a*2);
    if(btn.dataset.q==="max")  elBetAmount.value = state.maxBet;
  });
});

elBetBtn.addEventListener("click", async ()=>{
  const amount = Math.max(state.minBet, Number(elBetAmount.value||0)|0);
  const auto = Number(elAutoCash.value||0);
  state.betAmount = amount;
  state.autoCash = Number.isFinite(auto) && auto>=1.01 ? Math.min(auto, state.maxX) : null;

  try{
    // const res = await postBet(amount, state.autoCash);
    // setBalance(res.balanceAfterBet ?? state.balance);

    state.hasBet = true;

    // aceitamos apostas apenas no cooldown (como nas plataformas)
    if(state.phase !== "cooldown"){
      // opcional: exibir aviso visual
      // console.warn("Apostas só no período de cooldown.");
    }
    elCashoutBtn.disabled = (state.phase!=="running");
  }catch(e){
    console.error(e);
  }
});

$("cashoutBtn").addEventListener("click", ()=>doCashout("manual"));

async function doCashout(origin="manual"){
  if(state.phase!=="running" || !state.hasBet) return;
  try{
    elCashoutBtn.disabled = true;
    // const res = await postCashout(); setBalance(res.balance ?? state.balance);
    const won = Math.floor(state.betAmount * state.currentX);
    setBalance(state.balance + won);
    state.hasBet = false;
  }catch(e){
    elCashoutBtn.disabled = false;
  }
}

// ===== BOOT =====
function init(){
  fetchBalance();
  computeGraphHeight();
  renderHistory();               // começa vazio
  startCooldown(state.cooldownSec); // inicia o ciclo imediatamente
}
init();
