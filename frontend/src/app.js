// Usa objetos globais: Telegram.WebApp e TonConnectUI (carregados via CDN)

(function(){
  const API = (window.BACKEND_URL || "https://crash-ton.onrender.com");
  const WS_URL = API.replace(/^http/,"ws") + "/ws";

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

    // WebSocket
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (ev)=>{
      const msg = JSON.parse(ev.data);
      if(msg.type==="tick"){
        document.getElementById("phase").textContent = "running";
        document.getElementById("mult").textContent = `${Number(msg.multiplier).toFixed(2)}x`;
        document.getElementById("crash").textContent = `${Number(msg.crash).toFixed(2)}`;
      }else if(msg.type==="state"){
        document.getElementById("phase").textContent = msg.phase;
        if(msg.phase!=="running") document.getElementById("mult").textContent = "Aguardando...";
      }
    };

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

    const tg = Telegram?.WebApp;
    tg?.ready();
    const tg_id = tg?.initDataUnsafe?.user?.id?.toString() || "dev";

    document.getElementById("betBtn").onclick = async ()=>{
      const amount = parseFloat(document.getElementById("betAmt").value);
      await post("/bet",{tg_id,amount});
      alert("Aposta feita!");
    };
    document.getElementById("cashBtn").onclick = async ()=>{
      const res = await post("/cashout",{tg_id});
      alert(`Retirado em ${res.multiplier}x → +${res.payout} TON`);
    };
  }

  window.__CrashApp = { buildApp };
})();
