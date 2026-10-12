// Punto de entrada de la demo: API simulada en memoria y rutas con # (sin servidor)
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../App";
import { installMockApi } from "./mockApi";
import "../styles.css";

installMockApi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App demo />
    </HashRouter>
  </React.StrictMode>,
);
