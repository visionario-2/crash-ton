// app.js — monta UI e conecta no backend (/stream)
// Requer: <script src="/_config.js"> definiu window.CONFIG.API_BASE

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
      <div style="padding:16px;max-width:720px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">🚀 Crash TON</h2>
          <div id="ton-connect" style="position:relative;z-index:1;"></div>
        </div>

        <div id="lastCrashes" style="margin:10px 0 6px 0;font-size:12px;opacity:.9;"></div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>Fase: <b id="phase">preparing</b></div>
            <div id="countdown" style="font-size:12px;opacity:.8"></div>
          </div>

          <div id="arena" style="position:relative;height:140px;margin-top:8px;overflow:hidden;background:rgba(255,255,255,0.03);border-radius:12px">
            <div id="rocket" style="position:absolute;left:12px;bottom:8px;font-size:26px;">🚀</div>
            <div id="multBig" style="position:absolute;right:14px;bottom:10px;font-weight:800;font-size:38px;">Aguardando...</div>
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
            Para depositar, use o botão <b>💰 Depositar</b> no chat do bot.
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

    // saldo (se existir rota)
    async function refreshBalance(){
      try{
        const r = await fetch(`${API}/balance/${tg_id}`, {cache:"no-store"});
        if (!r.ok) throw 0;
        const d = await r.json();
        $("#balance").textContent = `Saldo: ${Number(d.balance_ton||0).toFixed(6)} TON`;
      }catch{ $("#balance").textContent = "Saldo: --"; }
    }
    refreshBalance();

    // histórico (usa GET /history)
    async function loadHistory(){
      try{
        const r = await fetch(API + "/history?limit=10");
        if (!r.ok) throw 0;
        const {crashes=[]} = await r.json();
        $("#lastCrashes").innerHTML = crashes.map(x => {
          const v = Number(x).toFixed(x>=10?2:2);
          const color = (x>=2 ? "#22c55e" : x>=1.5 ? "#eab308" : "#9ca3af");
          return `<span style="margin-right:10px;color:${color}">${v}x</span>`;
        }).join("");
      }catch{}
    }
    loadHistory();

    // helpers para POST (aposta e retirada – se tiver backend dessas rotas)
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
        await post("/bet",{tg_id,amount});
        alert("✅ Aposta feita!");
        refreshBalance();
      }catch(e){ alert("Erro: "+e.message); }
    };
    $("#cashBtn").onclick = async ()=>{
      try{
        const res = await post("/cashout",{tg_id});
        alert(`💸 Retirado em ${res.multiplier}x → +${res.payout} TON`);
        refreshBalance();
      }catch(e){ alert("Erro: "+e.message); }
    };

    // ===== WS + animação (compatível com backend) =====
    let ws, last = {x:1, phase:"preparing"}, prepTimer;
    const multEl = $("#multBig");
    const rocket = $("#rocket");
    const prepBar = $("#prepBar");

    // animação simples usando o último x conhecido
    function anim(){
      if(last.phase === "running"){
        multEl.textContent = `${Number(last.x).toFixed(2)}x`;
        const h = Math.min(100, (last.x-1)*12);
        rocket.style.transform = `translateY(${-h}px)`;
      }
      requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);

    function updatePreparingCountdown(startedAt, endsAt){
      clearInterval(prepTimer);
      const cd = $("#countdown");
      prepTimer = setInterval(() => {
        const now = Date.now();
        const total = Math.max(500, endsAt - startedAt);
        const left = Math.max(0, Math.ceil((endsAt - now)/100)/10); // décimos
        const pct = Math.max(0, Math.min(1, (now - startedAt)/total)) * 100;
        prepBar.style.width = `${pct}%`;
        cd.textContent = `${left.toFixed(1)}s`;
        if (now >= endsAt) { clearInterval(prepTimer); }
      }, 100);
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

          if (msg.type === "phase") {
            setPhase(msg.phase);

            if (msg.phase === "preparing") {
              enableBet(true);
              enableCash(false);
              multEl.textContent = "Aguardando...";
              rocket.style.transform = "translateY(0)";

              // mostrar e zerar barra
              prepBar.style.display = "block";
              prepBar.style.background = "#22c55e";
              prepBar.style.width = "0%";

              if (msg.startedAt && msg.endsAt) {
                updatePreparingCountdown(msg.startedAt, msg.endsAt);
              }
            }
            else if (msg.phase === "running") {
              // finalizar a barra do preparing e esconder
              clearInterval(prepTimer);
              $("#countdown").textContent = "";
              prepBar.style.width = "100%";
              prepBar.style.background = "#334155";   // cinza
              setTimeout(() => { prepBar.style.display = "none"; }, 100);

              enableBet(false);
              enableCash(true);
              last = { ...last, phase:"running", x:1 };
            }
            else if (msg.phase === "crashed") {
              enableBet(false);
              enableCash(false);

              // esconder barra e limpar
              clearInterval(prepTimer);
              prepBar.style.display = "none";
              prepBar.style.width = "0%";
              $("#countdown").textContent = "";

              multEl.textContent = "Aguardando...";
              rocket.style.transform = "translateY(0)";
              if (typeof msg.crashX === "number") setCrash(msg.crashX);
              loadHistory();
              last = { ...last, phase:"preparing", x:1 };
            }
          }

          if (msg.type === "tick" && typeof msg.x === "number") {
            last = { ...last, x: msg.x, phase:"running" };
            setMult(msg.x);
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
