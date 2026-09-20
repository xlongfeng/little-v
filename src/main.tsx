import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TickerOverlay } from "./Ticker";

const view = new URLSearchParams(window.location.search).get("view");
const Root = view === "ticker" ? TickerOverlay : App;
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
