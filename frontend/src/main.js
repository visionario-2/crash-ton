console.log("Crash Frontend: crash_ws4");

let state = {
  phase: "idle",
  currentX: 1,
  maxX: 100,
  hasBet: false,
};

// ELEMENTOS DA TELA
const elBig = document.querySelector(".mult-big") || (() => {
  const el = document.createElement("div");
  el.className = "mult-big waiting";
  el.textContent = "1.00×";
  document.body.appendChild(el);
  return el;
})();
const elCrashTxt = document.createElement("div");

// =======================
// CONEXÃO COM BACKEND
// =======================

let ws;

function wsUrlTry(path) {
  const base = (window.CONFIG?.API_BASE || location.origin).replace(/\/+$/, "");
  return base.replace(/^http/i, "ws") + path;
}

function connectWS() {
  // tenta /ws e se falhar tenta /stream
  const tryPaths = ["/ws", "/stream"];
  let idx = 0;

  function openNext() {
    if (idx >= tryPaths.length) {
      console.error("❌ Nenhum caminho WS funcionou");
      return;
    }
    const url = wsUrlTry(tryPaths[idx++]);
    ws = new WebSocket(url);
    ws.onopen = () => console.log("✅ WS conectado:", url);
    ws.onclose = () => {
      console.warn("⚠️ WS desconectado:", url);
      setTimeout(openNext, 1000);
    };
    ws.onmessage = onWsMessage;
  }

  openNext();
}

connectWS();

// =======================
// RECEBENDO MENSAGENS
// =======================

function onWsMessage(ev) {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "phase") {
      const phase = (msg.phase || "").toLowerCase();

      if (phase === "preparing" || phase === "cooldown") {
        elBig.textContent = "Aguardando 20s...";
        elBig.className = "mult-big waiting";
        state.phase = "cooldown";
      } else if (phase === "running") {
        state.phase = "running";
        state.currentX = 1;
        elBig.textContent = "1.00×";
        elBig.className = "mult-big";
      } else if (phase === "crashed") {
        state.phase = "crashed";
        const x = Number(msg.x || state.currentX);
        elBig.textContent = `${x.toFixed(2)}×`;
        elBig.className = "mult-big crashed";
      }
    } else if (msg.type === "tick") {
      state.currentX = msg.x;
      if (state.phase === "running") {
        elBig.textContent = `${state.currentX.toFixed(2)}×`;
      }
    } else if (msg.type === "crash") {
      const x = Number(msg.x || 1);
      elBig.textContent = `${x.toFixed(2)}×`;
      elBig.className = "mult-big crashed";
    }
  } catch (e) {
    console.warn("Erro ao ler WS:", e, ev.data);
  }
}
