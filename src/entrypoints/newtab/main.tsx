// must stay the first import: it may reload the page before anything boots
import { refocusing } from "./refocus";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/app/newtab/App";
import "@/core/i18n";
import "@/styles/tokens.css";
import "@/styles/global.css";

// Register all features (side-effect imports populate the Feature Registry)
import "@/features/newtab";

// Reduce the risk of the browser evicting IndexedDB data (wallpapers...)
navigator.storage?.persist?.().catch(() => {});

// about to reload for focus — don't spend a render (and a Wallhaven check) on a page being thrown away
if (!refocusing) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
