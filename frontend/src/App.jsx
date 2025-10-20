import WebApp from "@twa-dev/sdk";
import { TonConnectUI } from "@tonconnect/ui";

const API = (import.meta?.env?.VITE_BACKEND_URL) || (window.BACKEND_URL) || "https://SEU_BACKEND.onrender.com";
const WS_URL = API.replace(/^http/,"ws") + "/ws";

export default function App(){
  const root = document.createElement("div");
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
        <p style="opacity:.8;margin-top:10px">Para depositar, use o botão <b>💰 Depositar</b> no chat do bot.</p>
      </div>
    </div>
  `;

  // TON Connect UI
  const ton = new TonConnectUI({
    manifestUrl: (window.TON_MANIFEST_URL || "/public/tonconnect-manifest.json")
  });
  ton.ui.mount(root.querySelector("#ton-connect"));

  // WS
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (ev)=>{
    const msg = JSON.parse(ev.data);
    if(msg.type==="tick"){
      root.querySelector("#phase").textContent = "running";
      root.querySelector("#mult").textContent = `${Number(msg.multiplier).toFixed(2)}x`;
      root.querySelector("#crash").textContent = `${Number(msg.crash).toFixed(2)}`;
    }else if(msg.type==="state"){
      root.querySelector("#phase").textContent = msg.phase;
      if(msg.phase!=="running") root.querySelector("#mult").textContent = "Aguardando...";
    }
  };

  // helpers HTTP
  async function post(path, body){
    const r = await fetch(API+path, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  const tg_id = WebApp.initDataUnsafe?.user?.id?.toString() || "dev";

  root.querySelector("#betBtn").onclick = async ()=>{
    const amount = parseFloat(root.querySelector("#betAmt").value);
    await post("/bet",{tg_id,amount});
    alert("Aposta feita!");
  };
  root.querySelector("#cashBtn").onclick = async ()=>{
    const res = await post("/cashout",{tg_id});
    alert(`Retirado em ${res.multiplier}x → +${res.payout} TON`);
  };

  return root;
}
