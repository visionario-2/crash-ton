// ===== CONFIG =====
const API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || "/api";

// ===== ESTADO =====
const state = {
  phase: "idle",              // idle | betting | running | crashed
  k: 0.00012,                 // velocidade da curva
  currentX: 1.0,
  crashedAt: null,
  roundId: null,
  hasBet: false,
  betAmount: 100,
  autoCash: null,
  balance: 0,
  minBet: 10,
  maxBet: 100000,
  autoplayDemo: true,         // inicia animação mesmo sem BET (para mostrar movimento)
};

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
const elTrendsBar = $("trendsBar");
const elGraph = $("graph");
const elPhaserRoot = $("phaser-root");

// ===== FORMATAÇÃO =====
const fmt = {
  mult: (x)=> `${x.toFixed(2)}×`,
  num: (n)=> (Number.isFinite(n)? n.toLocaleString("pt-BR"): n),
};
function setPhase(p){ state.phase=p; elPhase.textContent=p; }
function setBalance(v){ state.balance=v; elBal.textContent=fmt.num(v); }

// ===== TELEGRAM VIEWPORT / RESIZE =====
function currentVH(){
  const tg = window.Telegram && window.Telegram.WebApp;
  // use a altura do webapp se disponível (em px)
  return (tg && tg.viewportHeight) ? tg.viewportHeight : window.innerHeight;
}
/* calcula altura do gráfico para caber no miniapp:
   área toda - (topbar + trends + paddings + painéis controles + status) */
function computeGraphHeight(){
  const vh = currentVH();
  // ajustes base aproximados (compensam paddings e painéis):
  const reserved = 240; // cabeçalho + trends + controles + status
  const h = Math.max(320, Math.min(540, vh - reserved));
  document.documentElement.style.setProperty("--graph-h", `${Math.round(h)}px`);
}
computeGraphHeight();
window.addEventListener("resize", computeGraphHeight);
if(window.Telegram && window.Telegram.WebApp){
  Telegram.WebApp.onEvent("viewportChanged", computeGraphHeight);
  Telegram.WebApp.expand && Telegram.WebApp.expand(); // tenta ocupar a área máxima
}

// ===== BACKEND (stubs – troque pelos seus endpoints) =====
async function fetchBalance(){
  try{
    const r = await fetch(`${API}/balance`);
    const j = await r.json();
    setBalance(j.balance ?? 0);
  }catch(_){ setBalance(0); }
}
async function postBet(amount, autoCash){
  const r = await fetch(`${API}/bet`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ amount, autoCash })
  });
  if(!r.ok) throw new Error("Falha na aposta");
  return r.json(); // { roundId, balanceAfterBet }
}
async function postCashout(){
  const r = await fetch(`${API}/cashout`, { method:"POST" });
  if(!r.ok) throw new Error("Falha no cashout");
  return r.json(); // { wonAmount, balance }
}

// ===== PHASER – cena com grid radial + curva =====
let phaserApp, gfx, labels = [], startTs=0;

class Scene extends Phaser.Scene{
  create(){
    gfx = this.add.graphics({ lineStyle: { width: 1, color: 0x233066, alpha: 1 } });
    this.time.addEvent({ delay: 33, loop:true, callback:()=>this.tick() });
    this.scale.on('resize', () => this.drawGrid(), this);
    this.drawGrid();
  }

  drawGrid(){
    const W = elPhaserRoot.clientWidth;
    const H = elPhaserRoot.clientHeight;
    gfx.clear();

    // fundo
    gfx.fillStyle(0x0b1230, 1).fillRect(0,0,W,H);

    const cx = Math.max(70, Math.floor(W*0.08));
    const cy = H - 36;
    const rMax = Math.min(W - (cx+40), H - 70);

    // anéis
    for(let i=1;i<=8;i++){
      const rr = (rMax/8)*i;
      gfx.lineStyle(1, 0x233066, 1);
      gfx.strokeCircle(cx,cy, rr);
    }

    // marcas (1x..10x)
    labels.forEach(t=>t.destroy());
    labels = [];
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

    // base
    gfx.lineStyle(1, 0x1f2a5a, 1).beginPath().moveTo(cx,cy).lineTo(W-20, cy).strokePath();
  }

  tick(){
    const W = elPhaserRoot.clientWidth;
    const H = elPhaserRoot.clientHeight;
    if(!W || !H) return;

    // curva
    const cx = Math.max(70, Math.floor(W*0.08));
    const cy = H - 36;
    const rMax = Math.min(W - (cx+40), H - 70);

    const color = (state.phase==="crashed")? 0xff4d5a : 0x5c7cff;
    gfx.lineStyle(4, color, 1).beginPath();

    const x = Math.min(state.currentX, 10);
    const t = (x-1)/9; // 0..1 de 1x a 10x
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

    elBig.textContent = `${state.currentX.toFixed(2)}×`;
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

// ===== LÓGICA =====
function reset(){
  setPhase("idle");
  state.currentX = 1.0;
  state.crashedAt = null;
  elCrashTxt.textContent = "—";
  elCashoutBtn.disabled = true;
  elBetBtn.disabled = false;
}
function startCurve(){
  setPhase("running");
  startTs = performance.now();
  const step = ()=>{
    if(state.phase!=="running") return;
    const dt = (performance.now()-startTs);
    state.currentX = Math.max(1, Math.exp(state.k * dt/16.6667));
    if(state.hasBet && state.autoCash && state.currentX >= state.autoCash){
      doCashout("auto"); return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function simulateCrashAt(x){
  const target = Math.max(1.01, x);
  const loop = ()=>{
    if(state.phase!=="running") return;
    if(state.currentX >= target){
      setPhase("crashed");
      state.crashedAt = state.currentX;
      elCrashTxt.textContent = `${state.currentX.toFixed(2)}×`;
      if(state.hasBet){ elCashoutBtn.disabled = true; }
      setTimeout(()=>{ reset(); maybeAutoDemo(); }, 1600);
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// trends
function renderTrends(values){
  elTrendsBar.innerHTML = "";
  values.forEach(v=>{
    const b = document.createElement("div");
    b.className = "dot";
    if(v>=2) b.style.background = "#5c7cff";
    if(v>=4) b.style.background = "#12eab8";
    elTrendsBar.appendChild(b);
  });
}
let lastTrends = [3.87,12.19,1.27,2.73,1.86,3.02,1.22,1.55,2.03,4.83,1.06,4.12];
function pushTrend(x){ lastTrends.push(x); if(lastTrends.length>12) lastTrends.shift(); renderTrends(lastTrends); }

// ===== AÇÕES =====
document.querySelectorAll(".quick button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const a = Number(elBetAmount.value||state.minBet);
    if(btn.dataset.q==="min") elBetAmount.value = state.minBet;
    if(btn.dataset.q==="half") elBetAmount.value = Math.max(state.minBet, Math.floor(a/2));
    if(btn.dataset.q==="2x") elBetAmount.value = Math.min(state.maxBet, a*2);
    if(btn.dataset.q==="max") elBetAmount.value = state.maxBet;
  });
});

elBetBtn.addEventListener("click", async ()=>{
  const amount = Math.max(state.minBet, Number(elBetAmount.value||0)|0);
  const auto = Number(elAutoCash.value||0);
  state.betAmount = amount;
  state.autoCash = Number.isFinite(auto)&&auto>=1.01 ? auto : null;

  try{
    elBetBtn.disabled = true;

    // backend real:
    // const res = await postBet(amount, state.autoCash);
    // setBalance(res.balanceAfterBet ?? state.balance);
    // state.roundId = res.roundId;

    state.hasBet = true;
    elCashoutBtn.disabled = false;

    if(state.phase==="idle"){
      startCurve();
      const rngCrash = 1 + Math.random()*10; // 1x–11x
      simulateCrashAt(rngCrash);
      pushTrend(rngCrash);
    }
  }catch(e){
    elBetBtn.disabled = false;
  }
});

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
$("cashoutBtn").addEventListener("click", ()=>doCashout("manual"));

// ===== BOOT =====
function maybeAutoDemo(){
  if(!state.autoplayDemo) return;
  if(state.phase==="idle"){
    // animação “vitrine” pra não ficar parado a 1.00×
    startCurve();
    const rngCrash = 1 + Math.random()*6.5; // mais curto quando demo
    simulateCrashAt(rngCrash);
    pushTrend(rngCrash);
  }
}
reset();
fetchBalance();
renderTrends(lastTrends);
computeGraphHeight();
setTimeout(maybeAutoDemo, 600); // começa sozinho se ninguém apostar
