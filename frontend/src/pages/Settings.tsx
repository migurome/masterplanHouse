import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, BackupResult, Category, TagUsage } from "../api";
import { Link } from "react-router-dom";
import ConfirmButton from "../components/ConfirmButton";
import { findOrCreateTag } from "../tags";
import { NavItem, orderNav } from "../nav";
import { VERSIONS } from "../versions";
import { money, PALETTE, seriesColor } from "../format";

export default function Settings({ nav, onNav, extra }: { nav: NavItem[]; onNav: (items: NavItem[]) => void; extra?: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [tags, setTags] = useState<TagUsage[]>([]);
  const [newTag, setNewTag] = useState("");

  const load = () => {
    api.categories().then(setCategories);
    api.tags().then(setTags);
  };
  useEffect(load, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    const used = new Set(categories.map((c) => c.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? null;
    if (await run(() => api.createCategory({ name: newCategory.trim(), color }))) setNewCategory("");
  };

  const addTag = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => findOrCreateTag(tags, newTag))) setNewTag("");
  };

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {extra}

      <section className="card">
        <h2>Pestañas</h2>
        <p className="muted small section-sub">
          Cambia el orden arrastrando las pestañas del menú o con las flechas. Cada usuario tiene su propio orden.
        </p>
        <ol className="edit-list nav-order">
          {nav.map((item, i) => (
            <li key={item.path}>
              <span className="grow">{item.label}</span>
              <button type="button" className="ghost small" aria-label={`Subir ${item.label}`} disabled={i === 0}
                onClick={() => onNav([...nav.slice(0, i - 1), item, nav[i - 1], ...nav.slice(i + 1)])}>↑</button>
              <button type="button" className="ghost small" aria-label={`Bajar ${item.label}`} disabled={i === nav.length - 1}
                onClick={() => onNav([...nav.slice(0, i), nav[i + 1], item, ...nav.slice(i + 2)])}>↓</button>
            </li>
          ))}
        </ol>
        <button type="button" className="link-button small" onClick={() => onNav(orderNav(undefined))}>Restablecer el orden</button>
      </section>

      <BackupSection />

      <section className="card">
        <h2>Categorías</h2>
        <ul className="edit-list">
          {categories.map((c) => (
            <li key={c.id}>
              <span className="swatch" style={{ background: seriesColor(c.color) }} />
              <input aria-label="Nombre" className="grow" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && run(() => api.updateCategory(c.id, { ...c, name: e.target.value }))} />
              <ConfirmButton question="Sus gastos quedarán sin categoría." onConfirm={() => run(() => api.deleteCategory(c.id))} />
            </li>
          ))}
        </ul>
        <form className="add-row" onSubmit={addCategory}>
          <input id="new-category" className="grow" placeholder="Nueva categoría" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} required />
          <button>Añadir categoría</button>
        </form>
      </section>

      <section className="card">
        <h2>Etiquetas</h2>
        <p className="muted small section-sub">
          Las etiquetas agrupan gastos de cualquier categoría (por ejemplo «Trenes», «Blablacar» o «Boda Bobi»).
          Un gasto puede llevar varias. Se ponen en la ficha del gasto o a toda una lista filtrada desde Gastos.
        </p>
        <ul className="edit-list">
          {tags.map((t) => (
            <li key={t.id}>
              <span className="swatch" style={{ background: t.color ?? "var(--muted)" }} />
              <input aria-label="Nombre de la etiqueta" className="grow" defaultValue={t.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(() => api.updateTag(t.id, { name: e.target.value, color: t.color }))} />
              <Link className="small muted nowrap" to={`/gastos?etiqueta=${t.id}`}>{t.count} gastos · {money(t.total)}</Link>
              <ConfirmButton question="Los gastos se quedan, solo pierden la etiqueta." onConfirm={() => run(() => api.deleteTag(t.id))} />
            </li>
          ))}
          {tags.length === 0 && <li className="muted small">Aún no hay etiquetas.</li>}
        </ul>
        <form className="add-row" onSubmit={addTag}>
          <input id="new-tag" className="grow" placeholder="Nueva etiqueta" value={newTag} onChange={(e) => setNewTag(e.target.value)} required />
          <button>Añadir etiqueta</button>
        </form>
      </section>
      <p className="muted small center">
        Versión {VERSIONS[0].version} · <Link to="/versiones">ver el historial de versiones</Link>
      </p>
    </div>
  );
}

function BackupSection() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importBackup(file, mode));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Copias de seguridad</h2>
      <p className="muted small">
        Un archivo .zip con todos los gastos, categorías y facturas en PDF. Sirve para guardar copias o para
        pasar los datos a otro servidor (por ejemplo, de este equipo a Supabase).
      </p>
      <div className="backup-row">
        <a className="button" href={api.backupExportUrl(true)} download>Descargar copia completa</a>
        <a className="button ghost" href={api.backupExportUrl(false)} download>Solo datos (sin PDF)</a>
      </div>

      <h3 className="subhead">Restaurar una copia</h3>
      <div className="backup-row">
        <input id="backup-file" type="file" accept=".zip,application/zip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        <label className="check">
          <input type="radio" name="backup-mode" checked={mode === "merge"} onChange={() => setMode("merge")} />
          Añadir lo que falte
        </label>
        <label className="check">
          <input type="radio" name="backup-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
          Reemplazar todo
        </label>
        {mode === "merge" ? (
          <button disabled={!file || busy} onClick={restore}>{busy ? "Importando…" : "Importar"}</button>
        ) : (
          <ConfirmButton
            className="danger" label={busy ? "Importando…" : "Reemplazar datos"}
            question="Se borrarán los datos actuales." onConfirm={restore}
          />
        )}
      </div>
      {mode === "replace" && <p className="notice small">Reemplazar borra los gastos, categorías y PDF actuales y deja solo los de la copia.</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="missing-ok">
          Importado: {result.gastos} gastos, {result.documentos} PDF y {result.categorias} categorías nuevas
          {result.gastos_omitidos > 0 && ` (${result.gastos_omitidos} gastos ya existían y se han omitido)`}.
        </p>
      )}
    </section>
  );
}
