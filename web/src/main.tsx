import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Board from "./screens/Board";
import "./index.css";

/*
 * Two entry points, no router.
 *
 * /board is a different application: no login, no tabs, no interaction, read
 * only, and driven by a token in the URL rather than a stored JWT. Picking it
 * here keeps a routing dependency out of the bundle for the sake of exactly one
 * alternative screen.
 */
const isBoard = window.location.pathname.replace(/\/+$/, "") === "/board";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isBoard ? <Board /> : <App />}
  </React.StrictMode>
);
