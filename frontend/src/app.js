// Usa objetos globais: Telegram.WebApp e TonConnectUI (carregados via CDN)

(function(){
  const API = (window.BACKEND_URL || "https://crash-ton.onrender.com");

  // função segura pra converter https:// → wss://
  function toWs(url){
    if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
    if (url.startsWith("http://"))  return "ws://"  + url.slice("http://".length);
    return url;
  }
  const WS_URL = toWs(API) + "/ws";

  // Constrói a UI
  function buildApp(){
    const root = document.getElementById("root");
    root.innerHTML = `
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2>🚀 Crash TON</h2>
          <div id="ton-connect"></div>
        </div>

        <div class="card">
          <div>Fase: <b id="phase">preparing</b></div>
          <div id="mult" style="font-size:42px;font-weight:800;margin-top:8px">Aguardando...</div>
          <div style="opacity:.8">Crash desta rodada: ~ <span id="crash">--</span>x</div>
        </div>

        <div class="card" style="background:#0b1220">
          <div>Valor da aposta (TON)</div>
          <input id="betAmt" value="0.2" />
          <div style="display:flex;gap:12px;margin-top:12px">
            <button id="betBtn" class="btn">Apostar</button>
            <button id="cashBtn" class="btn">Retirar</button>
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

    // === FUNÇÕES AUXILIARES ===
    function setPhase(p){ 
      const el = document.getElementById("phase");
      if(el) el.textContent = p;
    }

    // === CONEXÃO WEBSOCKET ===
    let ws;
    function connectWS(){
      try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          console.log("[WS] Conectado:", WS_URL);
          setPhase("preparing");
        };

        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);

          if(msg.type === "tick"){
            setPhase("running");
            document.getElementById("mult").textContent = `${Number(msg.multiplier).toFixed(2)}x`;
            document.getElementById("crash").textContent = `${Number(msg.crash).toFixed(2)}`;
          } 
          else if (msg.type === "state"){
            setPhase(msg.phase);
            if(msg.phase !== "running"){
              document.getElementById("mult").textContent = "Aguardando...";
            }
          } 
          else if (msg.type === "error"){
            console.error("Erro do servidor:", msg.message);
          }
        };

        ws.onerror = (err) => {
          console.error("[WS] Erro:", err);
          setPhase("reconectando…");
        };

        ws.onclose = () => {
          console.warn("[WS] Fechado, tentando reconectar...");
          setPhase("reconectando…");
          setTimeout(connectWS, 2000); // reconecta a cada 2s
        };

      } catch (e) {
        console.error("Falha ao abrir WebSocket:", e);
        setPhase("erro");
        setTimeout(connectWS, 2000);
      }
    }

    connectWS();

    // === FUNÇÃO POST ===
    async function post(path, body){
      const r = await fetch(API+path, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }

    // === TELEGRAM ===
    const tg = Telegram?.WebApp;
    tg?.ready();
    const tg_id = tg?.initDataUnsafe?.user?.id?.toString() || "dev";

    // === BOTÕES ===
    document.getElementById("betBtn").onclick = async ()=>{
      try {
        const amount = parseFloat(document.getElementById("betAmt").value);
        await post("/bet",{tg_id,amount});
        alert("✅ Aposta feita com sucesso!");
      } catch(e){
        alert("Erro: "+e.message);
      }
    };

    document.getElementById("cashBtn").onclick = async ()=>{
      try {
        const res = await post("/cashout",{tg_id});
        alert(`💸 Retirado em ${res.multiplier}x → +${res.payout} TON`);
      } catch(e){
        alert("Erro: "+e.message);
      }
    };
  }

  window.__CrashApp = { buildApp };
})();
