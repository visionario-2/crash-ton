// ===== CONFIG =====
const API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || "/api";

// ===== MONTA A UI NO #root (sem framework) =====
(function mountUI(){
  const root = document.getElementById("root");
  root.innerHTML = `
    <div class="app">
      <header class="header">
        <div class="brand">
          <div class="logo-dot"></div>
          <span>Crash</span>
        </div>
        <div class="balance">
          <span>Saldo:</span>
          <strong id="balance">—</strong>
        </div>
      </header>

      <main class="main">
        <section class="left">
          <div id="phaser-root" class="graph"></div>
          <div class="round-status">
            <span id="roundLabel">Aguardando próxima rodada…</span>
            <span id="multiplierLabel" class="mult">1.00×</span>
          </div>
        </section>

        <section class="right">
          <div class="card bet-card">
            <h3>Aposta</h3>
            <label class="field">
              <span>Valor (Cash)</span>
              <input id="betAmount" type="number" min="1" step="1" placeholder="100" />
            </label>
            <label class="field">
              <span>Auto Cashout (×)</span>
              <input id="autoCash" type="number" min="1.01" step="0.01" placeholder="2.00" />
            </label>
            <div class="actions">
              <button id="betBtn" class="btn primary">Apostar</button>
              <button id="cashoutBtn" class="btn" disabled>Cashout</button>
            </div>
            <div id="betHint" class="hint">Pronto para apostar.</div>
          </div>

          <div class="card table-card">
            <div class="table-head">
              <span>Jogador</span><span>Valor</span><span>Cashout</span>
            </div>
            <div id="betsList" class="table-body"></div>
          </div>
        </section>
      </main>
    </div>
  `;
})();

// ===== ESTADO =====
const state = {
  phase: "idle",          // idle | betting | running | crashed
  roundId: null,
  startTs: 0,
  k: 0.00012,             // velocidade da curva
  currentX: 1.0,
  crashedAt: null,
  hasBet: false,
  betAmount: 0,
  autoCash: null,
  balance: 0,
};

// ===== UI =====
const $ = (id)=>document.getElementById(id);
const elBal = $("balance");
const elBetAmount = $("betAmount");
const elAutoCash = $("autoCash");
const elBetBtn = $("betBtn");
const elCashoutBtn = $("cashoutBtn");
const elMult = $("multiplierLabel");
const elRound = $("roundLabel");
const elHint = $("betHint");
const elBetsList = $("betsList");

// ===== UTIL =====
const fmt = {
  mult: (x) => `${x.toFixed(2)}×`,
  num: (v) => Number.isFinite(v) ? v.toLocaleString("pt-BR") : v,
};
function setBalance(v){ state.balance = v; elBal.textContent = fmt.num(v); }

// ===== BACKEND (troque pelos seus endpoints reais) =====
async function fetchBalance(){
  try{
    const r = await fetch(`${API}/balance`);
    const j = await r.json();
    setBalance(j.balance ?? 0);
  }catch(_){ setBalance(state.balance || 0); }
}

async function postBet(amount, autoCash){
  // Troque pelo seu FastAPI (guardar roundId, seed, etc.)
  const r = await fetch(`${API}/bet`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ amount, autoCash })
  });
  if(!r.ok) throw new Error("Falha na aposta");
  return r.json(); // { roundId, balanceAfterBet, ... }
}

async function postCashout(){
  const r = await fetch(`${API}/cashout`, { method:"POST" });
  if(!r.ok) throw new Error("Falha no cashout");
  return r.json(); // { wonAmount, balance }
}

// ===== PHASER (gráfico) =====
let phaserApp, curveObj;
const graphW = 900, graphH = 420;

class CrashScene extends Phaser.Scene {
  create(){
    this.add.rectangle(0,0, graphW*2,graphH*2, 0x0b1220).setOrigin(0);
    curveObj = this.add.graphics();
    this.bigText = this.add.text(graphW/2, graphH/2, "1.00×", {
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "64px",
      fontStyle: "bold",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.time.addEvent({ delay: 33, loop: true, callback: () => this.tick() });
  }
  tick(){
    this.bigText.setText(fmt.mult(state.currentX));
    curveObj.clear();
    const color = (state.phase === "crashed") ? 0xff3b3b : 0x4f7cff;
    curveObj.lineStyle(4, color, 1);

    const maxX = Math.max(state.currentX, 1.02);
    const pts = 200;
    curveObj.beginPath();
    for(let i=0;i<=pts;i++){
      const x = 1 + (maxX - 1) * (i/pts);
      const y = Math.log(x) / Math.log(maxX + 0.001);
      const px = 30 + (graphW-60) * (i/pts);
      const py = graphH - 40 - y*(graphH-120);
      if(i===0) curveObj.moveTo(px, py); else curveObj.lineTo(px, py);
    }
    curveObj.strokePath();

    if(state.phase === "crashed" && state.crashedAt){
      const t = 30 + (graphW-60) * ((state.crashedAt-1)/(Math.max(state.crashedAt, maxX)-1 || 1));
      curveObj.lineStyle(2, 0xff3b3b, 1).beginPath().moveTo(t, 40).lineTo(t, graphH-40).strokePath();
    }
  }
}

(function bootPhaser(){
  if(phaserApp) return;
  phaserApp = new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor:"#0b1220",
    scale: { parent:"phaser-root", mode: Phaser.Scale.NONE, width: graphW, height: graphH },
    scene:[CrashScene],
  });
})();

// ===== RODADA (cliente) =====
function resetForNextRound(){
  state.phase = "idle";
  state.roundId = null;
  state.startTs = 0;
  state.currentX = 1.0;
  state.crashedAt = null;
  state.hasBet = false;

  elCashoutBtn.disabled = true;
  elCashoutBtn.classList.remove("success","danger");
  elBetBtn.disabled = false;
  elBetBtn.classList.remove("danger");
  elHint.textContent = "Pronto para apostar.";
  elRound.textContent = "Aguardando próxima rodada…";
  elMult.textContent = fmt.mult(1);
}

function startLocalCurve(){
  state.phase = "running";
  state.startTs = performance.now();
  const step = () => {
    if(state.phase !== "running") return;
    const dt = (performance.now() - state.startTs);
    state.currentX = Math.max(1, Math.exp(state.k * dt/16.6667));
    elMult.textContent = fmt.mult(state.currentX);

    if(state.hasBet && state.autoCash && state.currentX >= state.autoCash){
      doCashout("auto"); return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function simulateCrashAt(x){
  const goal = Math.max(1.01, x);
  const check = () => {
    if(state.phase !== "running") return;
    if(state.currentX >= goal){
      state.phase = "crashed";
      state.crashedAt = state.currentX;
      elRound.textContent = `CRASH em ${fmt.mult(state.currentX)}`;
      elHint.textContent = "Rodada encerrada.";
      if(state.hasBet){
        elCashoutBtn.disabled = true;
        elCashoutBtn.classList.remove("success");
        elCashoutBtn.classList.add("danger");
        elHint.textContent = "Você perdeu esta rodada.";
      }
      setTimeout(resetForNextRound, 2500);
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

// ===== UI: AÇÕES =====
elBetBtn.addEventListener("click", async () => {
  const amount = Math.max(1, Number(elBetAmount.value||0)|0);
  const auto = Number(elAutoCash.value||0);
  const autoCash = Number.isFinite(auto) && auto>=1.01 ? auto : null;

  try{
    elBetBtn.disabled = true;
    elBetBtn.classList.add("danger");
    elHint.textContent = "Enviando aposta…";

    // Backend real:
    // const res = await postBet(amount, autoCash);
    // if(res.balanceAfterBet != null) setBalance(res.balanceAfterBet);
    // state.roundId = res.roundId;

    // Modo demo (enquanto liga o backend):
    state.hasBet = true;
    state.betAmount = amount;
    state.autoCash = autoCash;
    elCashoutBtn.disabled = false;
    elHint.textContent = "Aguarde…";

    if(state.phase === "idle") {
      elRound.textContent = "Rodada em andamento…";
      startLocalCurve();
      const randomCrash = 1 + Math.random()*3.5; // 1.0–4.5x
      simulateCrashAt(randomCrash);
    }
  }catch(e){
    elHint.textContent = "Falha ao apostar. Tente novamente.";
    elBetBtn.disabled = false;
    elBetBtn.classList.remove("danger");
  }
});

async function doCashout(origin="manual"){
  if(state.phase!=="running" || !state.hasBet) return;
  try{
    elCashoutBtn.disabled = true;
    elCashoutBtn.classList.add("success");
    elHint.textContent = "Processando cashout…";

    // const res = await postCashout();
    // if(res.balance != null) setBalance(res.balance);

    // Demo: credita local
    const won = Math.floor(state.betAmount * state.currentX);
    setBalance(state.balance + won);
    elHint.textContent = `Você recebeu ${fmt.num(won)} (x${state.currentX.toFixed(2)})`;
    state.hasBet = false;
  }catch(e){
    elHint.textContent = "Falha no cashout.";
  }
}
elCashoutBtn.addEventListener("click", () => doCashout("manual"));

// ===== BOOT =====
resetForNextRound();
fetchBalance();

// Lista de apostas (mock visual)
function addBetRow(name, value, cashout){
  const row = document.createElement("div");
  row.className = "table-row";
  row.innerHTML = `<span>${name}</span><span>${fmt.num(value)}</span><span>${cashout ? `<span class="badge-win">${cashout.toFixed(2)}×</span>` : `<span class="badge-loss">—</span>`}</span>`;
  elBetsList.prepend(row);
}
["Alice","Bob","Eve","Carlos"].forEach((u,i)=> addBetRow(u,(i+1)*100,i%2? (1.7+i*0.2): null));
