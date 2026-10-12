/**
 * Arranque de la web sobre la nube: carga y descifra los datos, y responde a las peticiones /api/* de la web con el
 * servidor del navegador (server/api.ts). Cada cambio se guarda cifrado en Supabase y se anota en la actividad.
 */
import { setDocumentLoader } from "../api";
import { supabase } from "./client";
import { ConflictError, fetchAll, files, lastActivityId, persist, pullChanges } from "./persist";
import { Ctx, describeChanges, HttpError, Server } from "./server/api";
import { exportBackup, importBackup } from "./server/backup";
import { Db } from "./server/db";
import { readPdf } from "./pdf/read";
import type { Member } from "./slots";

const DOC_URL = /^\/api\/documents\/(\d+)\/file$/;
const BACKUP_URL = /^\/api\/backup\/export(?:\?include_pdfs=(true|false))?$/;

export interface Runtime {
  /** Trae los cambios del otro usuario; devuelve cuántos registros han cambiado. */
  sync(): Promise<number>;
  stop(): void;
  progress(fn: (msg: string | null) => void): void;
}

const nowUtc = () => new Date().toISOString().slice(0, 19);
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function startCloud(me: Member, key: CryptoKey, signOut: () => void): Promise<Runtime> {
  const [records, since] = await Promise.all([fetchAll(key), lastActivityId()]);
  const db = new Db();
  db.load(records);
  let last = since;
  let report: (msg: string | null) => void = () => {};
  const fileStore = files(key);

  const ctx: Ctx = {
    user: me.name, today: todayLocal, now: nowUtc, files: fileStore, signOut,
    readPdf: (bytes, name, categories, hint) => readPdf(bytes, name, categories, hint),
    importBackup: async (file, mode) => importBackup(db, ctx, new Uint8Array(await file.arrayBuffer()), mode, report),
  };
  const server = new Server(db, ctx);

  // Las peticiones que cambian datos van de una en una (comparten la lista de cambios pendientes)
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function call(method: string, url: URL, body: unknown): Promise<[number, unknown]> {
    try {
      const [status, data] = await server.handle({ method, path: url.pathname, query: url.searchParams, body });
      const ops = db.takePending();
      if (ops.length) {
        report(ops.length > 20 ? `Guardando ${ops.length} cambios cifrados…` : null);
        await persist(key, db, ops);
        const entry = describeChanges(db, ops, method, url.pathname, me.name, nowUtc());
        if (entry) {
          db.create("log", entry);
          await persist(key, db, db.takePending());
        }
        report(null);
      }
      return [status, data];
    } catch (err) {
      db.takePending(); // lo que no se pudo guardar no se queda a medias en la lista
      report(null);
      if (err instanceof HttpError) return [err.status, { detail: err.message }];
      if (err instanceof ConflictError) return [409, { detail: err.message }];
      console.error(err);
      return [500, { detail: (err as Error).message || "Error inesperado" }];
    }
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (typeof input !== "string" || !input.startsWith("/api/")) return realFetch(input, init);
    const url = new URL(input, window.location.origin);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    const [status, data] = method === "GET" ? await call(method, url, body) : await serial(() => call(method, url, body));
    return new Response(status === 204 || data === null ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };

  // PDF: se descargan cifrados, se descifran aquí y se abren como archivo del navegador
  const pdfUrls = new Map<number, string>();
  const loadPdf = async (id: number) => {
    if (!pdfUrls.has(id)) {
      const doc = db.documents.get(id);
      if (!doc) throw new Error("PDF no encontrado");
      pdfUrls.set(id, URL.createObjectURL(new Blob([await fileStore.get(doc.uid)], { type: "application/pdf" })));
    }
    return pdfUrls.get(id)!;
  };
  setDocumentLoader(loadPdf);

  // Enlaces a PDF y a la copia de seguridad: se resuelven aquí en vez de pedirlos a un servidor
  const onClick = (ev: MouseEvent) => {
    const a = (ev.target as Element | null)?.closest?.("a");
    const href = a?.getAttribute("href") ?? "";
    const doc = href.match(DOC_URL);
    const backup = href.match(BACKUP_URL);
    if (!doc && !backup) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (doc) {
      const win = window.open("", "_blank");
      loadPdf(Number(doc[1])).then((u) => { if (win) win.location.href = u; else window.location.href = u; })
        .catch((err) => { win?.close(); alert(`No se puede abrir el PDF: ${err.message}`); });
      return;
    }
    report("Preparando la copia de seguridad…");
    exportBackup(db, ctx, backup![1] !== "false", report).then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `gastos-casa-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}${backup![1] === "false" ? "-sin-pdf" : ""}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }).catch((err) => alert(`No se ha podido hacer la copia: ${err.message}`)).finally(() => report(null));
  };
  document.addEventListener("click", onClick, true);

  const { data: { user } } = await supabase.auth.getUser();
  const myId = user?.id ?? "";

  // Entrada en la actividad
  db.create("log", { at: nowUtc(), user: me.name, action: "Entrar", summary: "Inicio de sesión con segundo factor y frase secreta", details: [] });
  persist(key, db, db.takePending()).catch(() => {});

  return {
    async sync() {
      return serial(async () => {
        const r = await pullChanges(key, db, last, myId);
        last = r.last;
        return r.others;
      });
    },
    stop() {
      window.fetch = realFetch;
      document.removeEventListener("click", onClick, true);
      setDocumentLoader(null);
      for (const u of pdfUrls.values()) URL.revokeObjectURL(u);
    },
    progress(fn) { report = fn; },
  };
}
