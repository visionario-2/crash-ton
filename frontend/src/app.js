// Usa objetos globais: Telegram.WebApp e TonConnectUI (carregados via CDN)

(function(){
  const API = (window.BACKEND_URL || "https://crash-ton.onrender.com");

  // https → wss, http → ws
  function toWs(url){
    if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
    if (url.startsWith("http://"))  return "ws://"  + url.slice("http://".length);
    return url;
  }
  const WS_URL = toWs(API) + "/ws";

  // helpers UI
  const $ = (sel) => document.querySelector(sel);
  const setPhase = (p) => { const el=$("#phase"); if(el) el.textContent=p; };
  const setMult  = (x) => { $("#mult").textContent = `${Number(x).toFixed(2)}x`; };
  const setCrash = (c) => { $("#crash").textContent = `${Number(c).toFixed(2)}`; };
  const setCountdown = (s) => { $("#countdown").textContent = s>0 ? `${s.toFixed(1)}s` : ""; };

  // state fallback
  let lastStateTs = 0;
  async function pollState(){
    try{
      const r = await fetch(API + "/state", { cache:"no-store" });
      if(!r.ok) throw new Error(await r.text());
      const s = await r.json();
      if(s.updated_at && s.updated_at !== lastStateTs){
        lastStateTs = s.updated_at;
        updateFromState(s);
      }
    }catch(_e){}
  }
  setInterval(pollState, 700);

  function updateFromState(s){
    setPhase(s.phase || "preparing");
    if(s.phase === "running"){
      setMult(s.multiplier || 1.0);
      if(typeof s.crash !== "undefined") setCrash(s.crash);
      enableBet(false);      // durante corrida: não permite apostar
      enableCash(true);      // permite retirar
      setCountdown(0);
    }else if(s.phase === "preparing"){
      $("#mult").textContent = "Aguardando...";
      if(typeof s.crash !== "undefined") setCrash(s.crash);
      enableBet(true);       // permite apostar
      enableCash(false);     // não dá para retirar
    }else if(s.phase === "crashed"){
      enableBet(false);
      enableCash(false);
    }
  }

  // habilitar/desabilitar botões + cursor
  function enableBet(on){
    const b = $("#betBtn");
    b.disabled = !on;
    b.style.opacity = on ? "1" : "0.5";
    b.style.cursor = on ? "pointer" : "not-allowed";
  }
  function enableCash(on){
    const b = $("#cashBtn");
    b.disabled = !on;
    b.style.opacity = on ? "1" : "0.5";
    b.style.cursor = on ? "pointer" : "not-allowed";
  }

  // carrega últimas rodadas
  async function loadHistory(){
    try{
      const r = await fetch(API + "/history?limit=14");
      const {crashes=[]} = await r.json();
      const bar = $("#lastCrashes");
      bar.innerHTML = crashes.map(x => {
        const v = Number(x).toFixed(x >= 10 ? 2 : 2);
        const color = (x >= 2 ? "#22c55e" : x >= 1.5 ? "#f59e0b" : "#9ca3af");
        return `<span style="margin-right:10px;color:${color}">${v}x</span>`;
      }).join("");
    }catch(_e){}
  }

  // WebSocket com reconexão + contador de cooldown
  let ws, prepTimer;
  function connectWS(){
    try{
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setPhase("preparing");
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);

        if(msg.type === "tick"){
          setPhase("running");
          setMult(msg.multiplier);
          setCrash(msg.crash);
          enableBet(false);
          enableCash(true);
          lastStateTs = Date.now()/1000;
        }
        else if (msg.type === "state"){
          // preparando com contador
          if(msg.phase === "preparing"){
            enableBet(true);
            enableCash(false);
            if(typeof msg.time_left === "number"){
              clearInterval(prepTimer);
              let t = msg.time_left;
              setCountdown(t);
              prepTimer = setInterval(()=>{
                t -= 0.1;
                setCountdown(Math.max(0, t));
                if(t <= 0) clearInterval(prepTimer);
              }, 100);
            }
          }
          if(msg.phase !== "running"){
            $("#mult").textContent = "Aguardando...";
          }
          if(typeof msg.crash !== "undefined") setCrash(msg.crash);
          setPhase(msg.phase);
          lastStateTs = Date.now()/1000;

          if(msg.phase === "crashed"){
            // recarrega histórico quando termina
            loadHistory();
            enableBet(false);
            enableCash(false);
          }
        }
        else if (msg.type === "error"){
          console.error("Erro do servidor:", msg.message);
        }
      };

      ws.onerror = () => { setPhase("reconectando…"); };
      ws.onclose  = () => { setPhase("reconectando…"); setTimeout(connectWS, 2000); };

    }catch(_e){
      setPhase("erro"); setTimeout(connectWS, 2000);
    }
  }

  // Constrói a UI
  function buildApp(){
    const root = document.getElementById("root");
    root.innerHTML = `
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">🚀 Crash TON</h2>
          <div id="ton-connect" style="position:relative;z-index:1;pointer-events:auto"></div>
        </div>

        <!-- últimas rodadas -->
        <div id="lastCrashes" style="margin:8px 0 6px 0; font-size:12px; opacity:.9;"></div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>Fase: <b id="phase">preparing</b></div>
            <div id="countdown" style="font-size:12px;opacity:.8"></div>
          </div>
          <div id="mult" style="font-size:42px;font-weight:800;margin-top:8px">Aguardando...</div>
          <div style="opacity:.8">Crash desta rodada: ~ <span id="crash">--</span>x</div>
        </div>

        <div class="card" style="background:#0b1220">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>Valor da aposta (TON)</div>
            <div id="balance" style="font-size:12px;opacity:.9"></div>
          </div>
          <input id="betAmt" value="0.2" style="cursor:text" />
          <div style="display:flex;gap:12px;margin-top:12px">
            <button id="betBtn" class="btn" style="cursor:pointer">Apostar</button>
            <button id="cashBtn" class="btn" style="cursor:not-allowed;opacity:.5" disabled>Retirar</button>
          </div>
          <p style="opacity:.8;margin-top:10px">
            Para depositar, use o botão <b>💰 Depositar</b> no chat do bot.
          </p>
        </div>
      </div>
    `;

    // TON Connect UI
    const ton = new TonConnectUI.TonConnectUI({
      manifestUrl: (window.TON_MANIFEST_URL || "/public/tonconnect-manifest.json")
    });
    ton.ui.mount(document.getElementById("ton-connect"));

    // Telegram WebApp
    const tg = Telegram?.WebApp; tg?.ready();
    const tg_id = tg?.initDataUnsafe?.user?.id?.toString() || "dev";

    // saldo do usuário
    async function refreshBalance(){
      try{
        const r = await fetch(`${API}/balance/${tg_id}`, {cache:"no-store"});
        const data = await r.json();
        $("#balance").textContent = `Saldo: ${Number(data.balance_ton||0).toFixed(6)} TON`;
      }catch(_e){ $("#balance").textContent = "Saldo: --"; }
    }
    refreshBalance();

    // HTTP helper
    async function post(path, body){
      const r = await fetch(API+path, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }

    // Ações (com try/catch e feedback)
    $("#betBtn").onclick = async ()=>{
      try{
        const amount = parseFloat($("#betAmt").value);
        await post("/bet",{tg_id,amount});
        alert("✅ Aposta feita!");
        refreshBalance();
      }catch(e){
        alert("Erro: "+e.message);
      }
    };

    $("#cashBtn").onclick = async ()=>{
      try{
        const res = await post("/cashout",{tg_id});
        alert(`💸 Retirado em ${res.multiplier}x → +${res.payout} TON`);
        refreshBalance();
      }catch(e){
        alert("Erro: "+e.message);
      }
    };

    // dados iniciais
    loadHistory();
    connectWS();
    pollState(); // busca 1x logo ao abrir
  }

  window.__CrashApp = { buildApp };
})();
