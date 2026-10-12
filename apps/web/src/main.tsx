import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fontsReady, installTheme } from "./theme.js";
import { App } from "./App.js";
import "./styles.css";
import "./design.css";

installTheme();
const root = document.getElementById("root");
// The first render waits for the fonts (2.5 s at most), so no text is laid out twice.
if (root)
  void fontsReady().then(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
