import WebApp from "@twa-dev/sdk";
import App from "./App.jsx";

WebApp.ready();
document.getElementById("root").appendChild(App());
