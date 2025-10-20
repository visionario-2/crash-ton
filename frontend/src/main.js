// garante que a UI nova do CrashApp monte corretamente
if (window.__CrashApp && typeof window.__CrashApp.buildApp === "function") {
  window.__CrashApp.buildApp();
} else {
  // fallback: tenta importar o app.js dinamicamente
  import("./app.js").then(() => {
    if (window.__CrashApp && window.__CrashApp.buildApp)
      window.__CrashApp.buildApp();
  });
}

// etiqueta no canto inferior para confirmar deploy
const tag = document.createElement("div");
tag.textContent = "build: rocket-ui";
tag.style.cssText =
  "position:fixed;right:8px;bottom:8px;font:12px/1.2 monospace;opacity:.5";
document.body.appendChild(tag);
