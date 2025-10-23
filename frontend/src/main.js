// main.js
(() => {
  const API = window.CONFIG?.API_BASE || "";
  const els = {
    phase: document.querySelector("#phaseText"),         // exibe “preparing/running/crashed”
    multi: document.querySelector("#multiplierText"),    // exibe “~ --x” / “1.23x”
    bet:   document.querySelector("#betInput"),
    btnBet: document.querySelector("#btnBet"),
    btnOut: document.querySelector("#btnCashout"),
    bar:   document.querySelector("#progress"),          // a barrinha
  };

  // Estado local
  let state = {
    phase: "preparing",
    endsAt: 0,       // timestamp ms (autoridade do servidor)
    startedAt: 0,    // quando começou a fase
    nowSkew: 0,      // correção de relógio cliente-servidor
    currentX: 1.0,
  };

  const log = (...a) => console.log("[CRASH]", ...a);

  // ---- Renderização ----
  function renderPhase() {
    els.phase.textContent = state.phase === "preparing"
      ? "Aguardando…"
      : state.phase === "running" ? "Rodando…" : "Crash!";
  }

  function renderMultiplier() {
    if (state.phase === "running") {
      els.multi.textContent = `${state.currentX.toFixed(2)}x`;
    } else if (state.phase === "preparing") {
      els.multi.textContent = "~ --x";
    } else {
      els.multi.textContent = "x";
    }
  }

  function renderBar() {
    const now = Date.now() + state.nowSkew;
    if (!els.bar) return;

    // Durações padrão (garantem barra mesmo se o servidor não mandar)
    const PREP_MS = 3500;
    const RUN_MS  = 8000;

    let pct = 0;
    if (state.phase === "preparing") {
      const total = Math.max(500, (state.endsAt || (state.startedAt + PREP_MS)) - state.startedAt);
      const elapsed = Math.max(0, now - state.startedAt);
      pct = Math.min(1, elapsed / total);
    } else if (state.phase === "running") {
      const total = Math.max(1000, (state.endsAt || (state.startedAt + RUN_MS)) - state.startedAt);
      const elapsed = Math.max(0, now - state.startedAt);
      pct = Math.min(1, elapsed / total);
    } else {
      pct = 1;
    }

    els.bar.style.width = `${Math.round(pct * 100)}%`;
  }

  // Atualiza X em “running” suavemente entre ticks do servidor
  function tickRunning() {
    if (state.phase !== "running") return;
    const now = Date.now() + state.nowSkew;
    const t = Math.max(0, (now - state.startedAt) / 1000);
    // Curva típica de crash (exponencial leve); ajuste se quiser
    const calcX = 1.0 * Math.pow(1.06, t);
    state.currentX = Math.max(state.currentX, calcX);
  }

  // Loop de animação
  setInterval(() => {
    tickRunning();
    renderMultiplier();
    renderBar();
  }, 50);

  // ---- Transporte (WS com fallback para SSE) ----
  let ws;
  let sse;
  let reconnectTimer;

  function applyServerNow(serverNowMs) {
    // Corrige defasagem de relógio
    state.nowSkew = (serverNowMs || Date.now()) - Date.now();
  }

  function onServerEvent(msg) {
    // Eventos esperados:
    // {type:"phase", phase:"preparing|running|crashed", startedAt, endsAt, now}
    // {type:"tick", x, now}
    // {type:"heartbeat", now}
    try {
      const data = typeof msg === "string" ? JSON.parse(msg) : msg;

      if (data.now) applyServerNow(data.now);

      if (data.type === "phase") {
        state.phase = data.phase;
        state.startedAt = data.startedAt || (Date.now() + state.nowSkew);
        state.endsAt = data.endsAt || 0;
        if (data.phase === "running") state.currentX = 1.0;
        renderPhase();
      } else if (data.type === "tick" && typeof data.x === "number") {
        state.currentX = data.x;
      }
    } catch (e) {
      console.error("bad message", e, msg);
    }
  }

  function connectWS() {
    try {
      ws = new WebSocket(API.replace(/^http/, "ws") + "/stream");
      ws.onopen = () => { log("stream connected"); clearTimeout(reconnectTimer); };
      ws.onmessage = (e) => onServerEvent(e.data);
      ws.onerror = () => { log("stream error"); ws.close(); };
      ws.onclose = () => {
        log("stream closed");
        // fallback para SSE se falhar repetidamente
        reconnectTimer = setTimeout(() => trySSE(), 1000);
      };
    } catch {
      trySSE();
    }
  }

  function trySSE() {
    if (sse) sse.close();
    if (ws && ws.readyState !== WebSocket.CLOSED) try { ws.close(); } catch {}
    log("trying SSE fallback");
    sse = new EventSource(API + "/sse");
    sse.onmessage = (e) => onServerEvent(e.data);
    sse.onerror = () => {
      log("sse error, retrying ws");
      sse.close();
      reconnectTimer = setTimeout(connectWS, 1200);
    };
  }

  // Controles (exemplos – ajuste às suas rotas)
  els.btnBet?.addEventListener("click", async () => {
    const v = parseFloat(els.bet.value || "0");
    await fetch(API + "/bet", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ amountTon: v }) });
  });

  els.btnOut?.addEventListener("click", async () => {
    await fetch(API + "/cashout", { method:"POST" });
  });

  // Inicializa
  connectWS();
})();
