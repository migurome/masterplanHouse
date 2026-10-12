/**
 * Solo para desarrollo: la web de la nube con el servidor del navegador y los datos en memoria (sin Supabase).
 * nube-prueba.html?zip=<dirección de una copia de seguridad .zip>
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../App";
import { setDocumentLoader } from "../api";
import "../styles.css";
import { Ctx, HttpError, Server } from "./server/api";
import { exportBackup, importBackup } from "./server/backup";
import { Db } from "./server/db";
import { readPdf } from "./pdf/read";

async function main() {
  const db = new Db();
  const files = new Map<string, Uint8Array>();
  const ctx: Ctx = {
    user: "prueba", today: () => new Date().toISOString().slice(0, 10), now: () => new Date().toISOString().slice(0, 19),
    files: { put: async (u, b) => { files.set(u, b); }, get: async (u) => files.get(u)!, del: async (u) => { files.delete(u); } },
    readPdf,
  };
  const zip = new URLSearchParams(window.location.search).get("zip");
  if (zip) await importBackup(db, ctx, new Uint8Array(await (await fetch(zip)).arrayBuffer()), "replace");
  db.takePending();
  const server = new Server(db, ctx);
  // Como en la nube: el PDF se abre como archivo del navegador
  setDocumentLoader(async (id) => URL.createObjectURL(new Blob([files.get(db.documents.get(id)!.uid)!], { type: "application/pdf" })));
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (typeof input !== "string" || !input.startsWith("/api/")) return realFetch(input, init);
    const url = new URL(input, window.location.origin);
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    let status = 200, data: unknown;
    try {
      [status, data] = await server.handle({ method: init?.method ?? "GET", path: url.pathname, query: url.searchParams, body });
    } catch (err) {
      [status, data] = [err instanceof HttpError ? err.status : 500, { detail: (err as Error).message }];
    }
    db.takePending();
    return new Response(status === 204 || data === null ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };
  void exportBackup;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <HashRouter><App cloud={{ banner: <div className="demo-banner">Prueba con datos en memoria: nada se guarda.</div> }} /></HashRouter>
    </React.StrictMode>,
  );
}
main();
