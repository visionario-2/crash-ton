// app.js — monta UI e conecta no backend (/stream)
// Requer: <script src="/_config.js"> definiu window.CONFIG.API_BASE

// Altura do foguete em % da arena (0 = chão, 1 = teto)
// - Sobe rápido entre 1.00x e 2.00x (35% da altura total)
// - Depois sobe mais devagar até encostar no teto só em 50x
function heightPctForMultiplier(x) {
  const cap = Math.min(Math.max(x, 1), 50);     // clamp 1..50
  const early = 0.35;                            // 35% da altura até 2x
  if (cap <= 2) {
    return (cap - 1) / (2 - 1) * early;         // 0..0.35
  } else {
    return early + ((cap - 2) / (50 - 2)) * (1 - early); // 0.35..1.0
  }
}

(function () {
  const API = (window.CONFIG?.API_BASE || "https://crash-ton.onrender.com");

  function toWs(url){
    if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
    if (url.startsWith("http://"))  return "ws://"  + url.slice("http://".length);
    return url;
  }
  const WS_URL = toWs(API) + "/stream";

  const $ = (s)=>document.querySelector(s);
  const setPhase = (p)=>{ const el=$("#phase"); if(el) el.textContent=p; };
  const setMult  = (x)=> { const el=$("#mult"); if (el) el.textContent = `${Number(x).toFixed(2)}x`; };
  const setCrash = (c)=> { const el=$("#crash"); if (el) el.textContent = `${Number(c).toFixed(2)}`; };

  // ===== UI base =====
  function buildApp(){
    const root = document.getElementById("root");
    if (!root) return;

    root.innerHTML = `
      <div style="padding:16px;max-width:980px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">🚀 Crash TON</h2>
          <div id="ton-connect" style="position:relative;z-index:1;"></div>
        </div>

        <div id="lastCrashes" style="margin:10px 0 6px 0;font-size:12px;opacity:.9;"></div>

        <div id="arena" class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>Fase: <b id="phase">preparing</b></div>
            <div id="countdown" style="font-size:12px;opacity:.8"></div>
          </div>

          <div style="position:relative;height:180px;margin-top:8px;overflow:hidden;background:rgba(255,255,255,0.03);border-radius:12px">
            <canvas id="chart" width="850" height="150" style="position:absolute;left:12px;top:12px;opacity:.4"></canvas>
            <div id="rocket" style="position:absolute;left:12px;bottom:8px;font-size:34px;">🚀</div>
            <div id="multBig" style="position:absolute;right:14px;bottom:10px;font-weight:800;font-size:42px;">Aguardando...</div>
          </div>

          <div style="opacity:.8;margin-top:6px">Crash desta rodada: ~ <span id="crash">--</span>x</div>

          <div style="margin-top:10px;height:6px;width:100%;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden">
            <div id="prepBar" style="height:100%;width:0%;background:#22c55e;transition:width .1s linear"></div>
          </div>
        </div>

        <div class="card" style="background:#0b1220">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>Valor da aposta (TON)</div>
            <div id="balance" style="font-size:12px;opacity:.9"></div>
          </div>
          <input id="betAmt" value="0.2" style="cursor:text"/>
          <div style="display:flex;gap:12px;margin-top:12px">
            <button id="betBtn" class="btn" style="cursor:not-allowed;opacity:.5" disabled>Apostar</button>
            <button id="cashBtn" class="btn" style="cursor:not-allowed;opacity:.5" disabled>Retirar</button>
          </div>
          <p style="opacity:.8;margin-top:10px">
            Para depositar (teste), chame <code>/deposit_mock</code> na API ou use o botão <b>💰 Depositar</b> no bot.
          </p>
        </div>
      </div>
    `;

    // TonConnect (opcional)
    try {
      const ton = new TonConnectUI.TonConnectUI({
        manifestUrl: (window.CONFIG?.TON_MANIFEST_URL || "/public/tonconnect-manifest.json")
      });
      ton.ui.mount(document.getElementById("ton-connect"));
    } catch {}

    // Telegram
    const tg = window.Telegram?.WebApp; tg?.ready();
    const tg_id = tg?.initDataUnsafe?.user?.id?.toString() || "dev";

    // saldo
    async function refreshBalance(){
      try{
        const r = await fetch(`${API}/balance/${tg_id}`, {cache:"no-store"});
        if (!r.ok) throw 0;
        const d = await r.json();
        $("#balance").textContent = `Saldo: ${Number(d.balance_ton||0).toFixed(6)} TON`;
      }catch{ $("#balance").textContent = "Saldo: --"; }
    }
    refreshBalance();

    // histórico
    async function loadHistory(){
      try{
        const r = await fetch(API + "/history?limit=10");
        if (!r.ok) throw 0;
        const {crashes=[]} = await r.json();
        $("#lastCrashes").innerHTML = crashes.map(x => {
          const v = Number(x).toFixed(2);
          const color = (x>=2 ? "#22c55e" : x>=1.5 ? "#eab308" : "#9ca3af");
          return `<span style="margin-right:10px;color:${color}">${v}x</span>`;
        }).join("");
      }catch{}
    }
    loadHistory();

    // helpers
    async function post(path, body){
      const r = await fetch(API+path, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }

    function enableBet(on){ const b=$("#betBtn"); b.disabled=!on; b.style.opacity=on?"1":".5"; b.style.cursor=on?"pointer":"not-allowed"; }
    function enableCash(on){ const b=$("#cashBtn"); b.disabled=!on; b.style.opacity=on?"1":".5"; b.style.cursor=on?"pointer":"not-allowed"; }

    $("#betBtn").onclick = async ()=>{
      try{
        const amount = parseFloat($("#betAmt").value);
        const res = await post("/bet",{tg_id,amount});
        alert("✅ Aposta feita!");
        refreshBalance();
      }catch(e){ alert("Erro: "+e.message); }
    };
    $("#cashBtn").onclick = async ()=>{
      try{
        const res = await post("/cashout",{tg_id});
        alert(`💸 Retirado em ${res.multiplier.toFixed(2)}x → +${Number(res.payout).toFixed(6)} TON`);
        refreshBalance();
      }catch(e){ alert("Erro: "+e.message); }
    };

    // ===== WS + animação =====
    let ws, last = {x:1, phase:"preparing"}, prepTimer;
    let nowSkew = 0;            // diferença server-now - client-now
    let lastCrash = null;       // para mostrar no preparing
    let lastHeightPct = 0;      // 0..1 (para posicionar a explosão)
    const multEl = $("#multBig");
    const rocket = $("#rocket");
    const prepBar = $("#prepBar");

    // gráfico
    const chart = document.getElementById("chart");
    const ctx = chart.getContext("2d");
    let points = [];   // {t_ms, x}
    let t0_ms = 0;

    function drawChart() {
      ctx.clearRect(0,0,chart.width,chart.height);
      const W = chart.width, H = chart.height;
      const T = 8000; // janela 8s
      const XMAX = 50; // escala vertical até 50x
      ctx.beginPath();
      const slice = points.slice(-200);
      slice.forEach((p, i) => {
        const tx = Math.max(0, Math.min(1, p.t_ms / T));
        const mx = Math.max(1, Math.min(XMAX, p.x));
        const xpix = tx * W;
        const ypix = H - (mx - 1) / (XMAX - 1) * H;
        if (i === 0) ctx.moveTo(xpix, ypix);
        else ctx.lineTo(xpix, ypix);
      });
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }

    // animação (posição do foguete)
    function anim(){
      if(last.phase === "running"){
        multEl.textContent = `${Number(last.x).toFixed(2)}x`;
        multEl.style.color = "#ffffff"; // branco durante running

        const pct = heightPctForMultiplier(last.x); // 0..1
        lastHeightPct = pct;
        const MAX = 120;  // altura em px da “pista” (ajuste se quiser)
        rocket.style.transform = `translateY(${-pct * MAX}px)`;
      }
      requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);

    function updatePreparingCountdown(startedAt, endsAt){
      clearInterval(prepTimer);
      const cd = $("#countdown");
      prepTimer = setInterval(() => {
        const now = Date.now() + nowSkew;   // relógio do servidor
        const total = Math.max(500, endsAt - startedAt);
        const leftMs = Math.max(0, endsAt - now);
        const left = Math.round(leftMs / 100) / 10; // décimos
        const pct = Math.max(0, Math.min(1, (now - startedAt)/total)) * 100;

        prepBar.style.width = `${pct}%`;
        cd.textContent = `${left.toFixed(1)}s`;

        if (now >= endsAt) { clearInterval(prepTimer); }
      }, 50); // 20 FPS suave
    }

    function connectWS(){
      try{
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          setPhase("preparing");
          enableBet(false);
          enableCash(false);
        };

        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);

          // corrige relógio local com base no servidor
          if (typeof msg.now === "number") {
            nowSkew = msg.now - Date.now();
          }

          if (msg.type === "phase") {
            setPhase(msg.phase);

            if (msg.phase === "preparing") {
              enableBet(true);
              enableCash(false);

              // mostrar último crash em VERMELHO e 💥 (sem resetar posição!)
              if (lastCrash != null) {
                multEl.textContent = `${Number(lastCrash).toFixed(2)}x`;
                multEl.style.color = "#ef4444";
              } else {
                multEl.textContent = "Aguardando...";
                multEl.style.color = "#ffffff";
              }
              rocket.textContent = "💥";
              rocket.style.fontSize = "40px";
              // não resetar transform aqui

              // barra de preparo
              prepBar.style.display = "block";
              prepBar.style.background = "#22c55e";
              prepBar.style.width = "0%";
              if (msg.startedAt && msg.endsAt) {
                updatePreparingCountdown(msg.startedAt, msg.endsAt);
              }

              // gráfico: mantém o traço da rodada anterior até iniciar a próxima
            }

            else if (msg.phase === "running") {
              clearInterval(prepTimer);
              $("#countdown").textContent = "";
              prepBar.style.width = "100%";
              prepBar.style.background = "#334155";
              setTimeout(() => { prepBar.style.display = "none"; }, 100);

              // volta pro foguete normal e pro chão
              rocket.textContent = "🚀";
              rocket.style.fontSize = "34px";
              multEl.style.color = "#ffffff";

              lastHeightPct = 0;
              rocket.style.transform = "translateY(0)";

              // gráfico: reset janela
              t0_ms = Date.now() + nowSkew;
              points = [];
              drawChart();

              enableBet(false);
              enableCash(true);
              last = { ...last, phase:"running", x:1 };
            }

            else if (msg.phase === "crashed") {
              enableBet(false);
              enableCash(false);

              // mostra o crash em vermelho
              if (typeof msg.crashX === "number") {
                const v = Number(msg.crashX);
                setCrash(v);
                multEl.textContent = `${v.toFixed(2)}x`;
                multEl.style.color = "#ef4444";
                lastCrash = v;
              }

              // 💥 exatamente onde o foguete parou
              rocket.textContent = "💥";
              rocket.style.fontSize = "40px";
              const MAX = 120;
              rocket.style.transform = `translateY(${-lastHeightPct * MAX}px)`;

              // tremidinha
              const arena = document.getElementById("arena");
              arena.classList.add("shake");
              setTimeout(()=>arena.classList.remove("shake"), 800);

              clearInterval(prepTimer);
              prepBar.style.display = "none";
              prepBar.style.width = "0%";
              $("#countdown").textContent = "";

              loadHistory();
              last = { ...last, phase:"preparing", x:1 };
            }
          }

          // ticks
          if (msg.type === "tick" && typeof msg.x === "number") {
            last = { ...last, x: msg.x, phase:"running" };
            setMult(msg.x);

            // gráfico
            const now = Date.now() + nowSkew;
            points.push({ t_ms: now - t0_ms, x: msg.x });
            drawChart();
          }
        };

        ws.onerror = () => { setPhase("reconectando…"); };
        ws.onclose  = () => { setPhase("reconectando…"); setTimeout(connectWS, 1500); };

      }catch{
        setPhase("erro"); setTimeout(connectWS, 1500);
      }
    }

    connectWS();
  }

  document.addEventListener("DOMContentLoaded", buildApp);
  window.__CrashApp = { buildApp };
})();
