// Usa objetos globais: Telegram.WebApp e TonConnectUI (carregados via CDN)

(function(){
  const API = (window.BACKEND_URL || "https://crash-ton.onrender.com");

  function toWs(url){
    if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
    if (url.startsWith("http://"))  return "ws://"  + url.slice("http://".length);
    return url;
  }
  const WS_URL = toWs(API) + "/ws";

  const $ = (s)=>document.querySelector(s);
  const setPhase = (p)=>{ const el=$("#phase"); if(el) el.textContent=p; };
  const setMult  = (x)=> { $("#mult").textContent = `${Number(x).toFixed(2)}x`; };
  const setCrash = (c)=> { $("#crash").textContent = `${Number(c).toFixed(2)}`; };

  // ===== UI base =====
  function buildApp(){
    const root = document.getElementById("root");
    root.innerHTML = `
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">🚀 Crash TON</h2>
          <div id="ton-connect" style="position:relative;z-index:1;"></div>
        </div>

        <!-- histórico das últimas 10 -->
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

          <!-- barra de progresso do preparing -->
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

    // TON connect
    const ton = new TonConnectUI.TonConnectUI({
      manifestUrl: (window.TON_MANIFEST_URL || "/public/tonconnect-manifest.json")
    });
    ton.ui.mount(document.getElementById("ton-connect"));

    // Telegram
    const tg = Telegram?.WebApp; tg?.ready();
    const tg_id = tg?.initDataUnsafe?.user?.id?.toString() || "dev";

    // saldo
    async function refreshBalance(){
      try{
        const r = await fetch(`${API}/balance/${tg_id}`, {cache:"no-store"});
        const d = await r.json();
        $("#balance").textContent = `Saldo: ${Number(d.balance_ton||0).toFixed(6)} TON`;
      }catch{ $("#balance").textContent = "Saldo: --"; }
    }
    refreshBalance();

    // histórico
    async function loadHistory(){
      try{
        const r = await fetch(API + "/history?limit=10");
        const {crashes=[]} = await r.json();
        $("#lastCrashes").innerHTML = crashes.map(x => {
          const v = Number(x).toFixed(x>=10?2:2);
          const color = (x>=2 ? "#22c55e" : x>=1.5 ? "#eab308" : "#9ca3af");
          return `<span style="margin-right:10px;color:${color}">${v}x</span>`;
        }).join("");
      }catch{}
    }
    loadHistory();

    // post helper
    async function post(path, body){
      const r = await fetch(API+path, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }

    // botões
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

    // ===== WS + animação =====
    let ws, prepTimer, lastTick = {mult:1, time:performance.now(), crash:0, phase:"preparing"};
    const multEl = $("#multBig");
    const rocket = $("#rocket");
    const prepBar = $("#prepBar");

    // animação suave com base no último tick (interpolação)
    function loop(){
      const now = performance.now();
      if(lastTick.phase === "running"){
        // usamos o último valor vindo do servidor (ele já é suave)
        multEl.textContent = `${Number(lastTick.mult).toFixed(2)}x`;
        // move o foguete proporcional ao multiplicador (efeito simples)
        const h = Math.min(100, (lastTick.mult-1)*12); // escala básica
        rocket.style.transform = `translateY(${-h}px)`;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

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

          if(msg.type === "tick"){
            setPhase("running");
            enableBet(false);
            enableCash(true);
            lastTick = { mult: Number(msg.multiplier)||1, time: performance.now(), crash: msg.crash, phase:"running" };
            setCrash(msg.crash);
          }

          else if (msg.type === "state"){
            setPhase(msg.phase);

            if(msg.phase === "preparing"){
              enableBet(true);
              enableCash(false);
              // barra de progresso (0 → 100%)
              if(typeof msg.time_left === "number"){
                const total = 10; // o backend está usando 10s
                const left = Math.max(0, Math.min(total, msg.time_left));
                const pct = (1 - left/total) * 100;
                prepBar.style.width = `${pct}%`;
                $("#countdown").textContent = `${left.toFixed(1)}s`;
              }
              multEl.textContent = "Aguardando...";
              rocket.style.transform = "translateY(0)";
            }

            if(typeof msg.crash !== "undefined")
              setCrash(msg.crash);

            if(msg.phase === "crashed"){
              enableBet(false);
              enableCash(false);
              loadHistory();
              prepBar.style.width = "0%";
              $("#countdown").textContent = "";
              rocket.style.transform = "translateY(0)";
              multEl.textContent = "Aguardando...";
            }
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

  window.__CrashApp = { buildApp };
})();
