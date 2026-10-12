import { DragEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, DocumentResult } from "../api";
import ConfirmButton from "../components/ConfirmButton";

interface Item {
  key: string;
  name: string;
  state: "en cola" | "analizando" | "ok" | "duplicado" | "error";
  result?: DocumentResult;
  error?: string;
}

export default function Upload() {
  const [items, setItems] = useState<Item[]>([]);
  const [failed, setFailed] = useState<DocumentResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const loadFailed = () => api.documents({ status: "error" }).then(setFailed);
  useEffect(() => { loadFailed(); }, []);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  // Se suben de uno en uno: cada PDF se analiza antes de responder
  const addFiles = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const queued = pdfs.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }));
    setItems((list) => [...queued.map(({ file, key }) => ({ key, name: file.name, state: "en cola" as const })), ...list]);
    for (const { file, key } of queued) {
      update(key, { state: "analizando" });
      try {
        const r = await api.uploadDocument(file);
        update(key, {
          result: r,
          state: r.duplicate ? "duplicado" : r.status === "procesado" ? "ok" : "error",
          error: r.error ?? undefined,
        });
      } catch (err) {
        update(key, { state: "error", error: (err as Error).message });
      }
    }
    loadFailed();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const retry = async (doc: DocumentResult) => {
    await api.reprocessDocument(doc.id);
    loadFailed();
  };

  const discard = async (doc: DocumentResult) => {
    await api.deleteDocument(doc.id);
    loadFailed();
  };

  return (
    <div className="stack">
      <section
        className={`card dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
      >
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <h2>Arrastra aquí tus facturas en PDF</h2>
        <p className="muted">o haz clic para elegirlas. Se leen automáticamente el importe, las fechas, el proveedor y la categoría.</p>
      </section>

      {items.length > 0 && (
        <section className="card">
          <h2>Esta sesión</h2>
          <ul className="upload-list">
            {items.map((it) => (
              <li key={it.key}>
                <span className={`state state-${it.state.replace(" ", "-")}`}>{it.state}</span>
                <span className="grow">{it.name}</span>
                {it.error && <span className="error small">{it.error}</span>}
                {it.result?.expense_id && <Link to="/gastos?pendientes=1">Revisar</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="card">
          <h2>Documentos con errores</h2>
          <ul className="upload-list">
            {failed.map((d) => (
              <li key={d.id}>
                <a className="grow" href={api.documentUrl(d.id)} target="_blank" rel="noreferrer">{d.original_name}</a>
                <span className="error small">{d.error}</span>
                <button className="ghost" onClick={() => retry(d)}>Reintentar</button>
                <ConfirmButton label="Eliminar" onConfirm={() => discard(d)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
