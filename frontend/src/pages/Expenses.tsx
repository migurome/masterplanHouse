import { DragEvent, FormEvent, InputHTMLAttributes, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, Category, Expense, ExpenseInput, loadDocumentUrl, Tag, TagUsage } from "../api";
import ConfirmButton from "../components/ConfirmButton";
import TagPicker, { TagChip } from "../components/TagPicker";
import { findOrCreateTag } from "../tags";
import { fold } from "../text";
import TagSidebar, { isTagDrag, readTagDrag, startTagDrag, TagDrag } from "../components/TagSidebar";
import ExpenseChart, { GroupBy } from "../components/ExpenseChart";
import { date, money } from "../format";

const SOURCE_LABEL: Record<string, string> = { pdf: "PDF", banco: "Banco", manual: "Manual" };

export default function Expenses() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [tags, setTags] = useState<TagUsage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<TagDrag | null>(null);
  const [dropRow, setDropRow] = useState<number | null>(null);
  // Gastos marcados con la casilla: la gráfica y las etiquetas en bloque se aplican solo a ellos
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filter = {
    year: params.get("anio") ?? "",
    category_id: params.get("categoria") ?? "",
    pending: params.get("pendientes") === "1",
    q: params.get("buscar") ?? "",
    from: params.get("desde") ?? "",
    to: params.get("hasta") ?? "",
    min: params.get("min") ?? "",
    max: params.get("max") ?? "",
    tag: params.get("etiqueta") ?? "",
    car: params.get("coche") ?? "",
    ids: params.get("ids") ?? "",
  };

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    api.expenses({
      year: filter.year,
      category_id: filter.category_id,
      reviewed: filter.pending ? false : undefined,
      q: filter.q || undefined,
      date_from: filter.from || undefined,
      date_to: filter.to || undefined,
      amount_min: filter.min || undefined,
      amount_max: filter.max || undefined,
      tag_id: filter.tag || undefined,
      car_kind: filter.car || undefined,
      ids: filter.ids || undefined,
    }).then((list) => {
      setExpenses(list);
      setSelected((sel) => new Set(list.filter((e) => sel.has(e.id)).map((e) => e.id))); // solo los que siguen
    });
    api.summary().then((s) => setYears(s.years));
  }, [filter.year, filter.category_id, filter.pending, filter.q, filter.from, filter.to, filter.min, filter.max, filter.tag, filter.car, filter.ids]);

  const loadTags = () => { api.tags().then(setTags); };
  useEffect(() => {
    api.categories().then(setCategories);
    loadTags();
  }, []);
  useEffect(load, [load]);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const picked = selected.size ? expenses.filter((e) => selected.has(e.id)) : expenses;
  const showChart = params.get("grafica") === "1";
  const groupBy = (params.get("por") as GroupBy) || "categoria";
  const allSelected = expenses.length > 0 && expenses.every((e) => selected.has(e.id));
  const toggleRow = (id: number) => setSelected((sel) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // Marca (o desmarca) un gasto para revisarlo más tarde, sin abrir la ficha
  const toggleReview = async (e: Expense) => {
    const updated = await api.setReview(e.id, !e.reviewed);
    if (filter.pending && updated.reviewed) load();
    else setExpenses((list) => list.map((x) => (x.id === e.id ? updated : x)));
  };

  // Poner o quitar una etiqueta a un gasto (arrastrando)
  const tagById = (id: number) => tags.find((t) => t.id === id);
  const setRowTags = (expenseId: number, fn: (ts: Tag[]) => Tag[]) =>
    setExpenses((list) => list.map((x) => (x.id === expenseId ? { ...x, tags: fn(x.tags) } : x)));
  const addTag = async (expenseId: number, tagId: number) => {
    const tag = tagById(tagId);
    const row = expenses.find((x) => x.id === expenseId);
    if (!tag || !row || row.tags.some((t) => t.id === tagId)) return;
    setRowTags(expenseId, (ts) => [...ts, { id: tag.id, name: tag.name, color: tag.color }].sort((a, b) => a.name.localeCompare(b.name)));
    await api.applyTag(tagId, [expenseId]);
    loadTags();
  };
  const removeTag = async (expenseId: number, tagId: number) => {
    setRowTags(expenseId, (ts) => ts.filter((t) => t.id !== tagId));
    await api.applyTag(tagId, [expenseId], true);
    loadTags();
    if (filter.tag === String(tagId)) load(); // ya no cumple el filtro
  };
  const dropOnRow = (e: DragEvent, expenseId: number) => {
    const drag = readTagDrag(e);
    setDropRow(null);
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.from === expenseId) return; // soltada en su propio gasto: no cambia nada
    addTag(expenseId, drag.tagId);
    if (drag.from != null) removeTag(drag.from, drag.tagId); // de un gasto a otro: se mueve
  };

  return (
    <div
      className="expenses-layout"
      // Una etiqueta de un gasto soltada fuera de los gastos se quita
      onDragOver={(e) => { if (dragging?.from != null && isTagDrag(e)) e.preventDefault(); }}
      onDrop={(e) => {
        const drag = readTagDrag(e);
        if (drag?.from != null) { e.preventDefault(); removeTag(drag.from, drag.tagId); }
      }}
    >
      <TagSidebar
        tags={tags}
        activeTag={filter.tag}
        dragging={dragging}
        onFilter={(id) => setFilter("etiqueta", id)}
        onCreated={loadTags}
        onDropRemove={(d) => d.from != null && removeTag(d.from, d.tagId)}
        onDragStart={setDragging}
        onDragEnd={() => { setDragging(null); setDropRow(null); }}
      />
    <div className="stack">
      <div className="filters expenses-filters">
        <label>
          Año
          <select value={filter.year} onChange={(e) => setFilter("anio", e.target.value)}>
            <option value="">Todos</option>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Categoría
          <select value={filter.category_id} onChange={(e) => setFilter("categoria", e.target.value)}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="0">Sin categoría</option>
          </select>
        </label>
        {filter.ids && (
          <span className="filter-chip">
            Gastos de Revisar ({filter.ids.split(",").length})
            <button type="button" aria-label="Quitar la selección" onClick={() => setFilter("ids", "")}>×</button>
          </span>
        )}
        {filter.car && (
          <span className="filter-chip">
            Coche: {filter.car}
            <button type="button" aria-label="Quitar el filtro del coche" onClick={() => setFilter("coche", "")}>×</button>
          </span>
        )}
        <label>
          Buscar
          <DebouncedInput type="search" value={filter.q} placeholder="mercadona · !condis"
            title="Busca en descripción, proveedor, notas y etiquetas. Varias palabras: tienen que estar todas. Con ! delante se excluyen (!mercadona !taxi)."
            onValue={(v) => setFilter("buscar", v)} />
        </label>
        <label>
          Desde
          <input type="date" value={filter.from} onChange={(e) => setFilter("desde", e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={filter.to} onChange={(e) => setFilter("hasta", e.target.value)} />
        </label>
        <label>
          Mín. €
          <DebouncedInput type="number" min="0" step="0.01" inputMode="decimal" className="amount-filter" value={filter.min}
            placeholder="0" onValue={(v) => setFilter("min", v)} />
        </label>
        <label>
          Máx. €
          <DebouncedInput type="number" min="0" step="0.01" inputMode="decimal" className="amount-filter" value={filter.max}
            placeholder="∞" onValue={(v) => setFilter("max", v)} />
        </label>
        <label>
          Etiqueta
          <select value={filter.tag} onChange={(e) => setFilter("etiqueta", e.target.value)}>
            <option value="">Todas</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={filter.pending} onChange={(e) => setFilter("pendientes", e.target.checked ? "1" : "")} />
          Pendientes
        </label>
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="card">
        <div className="table-head">
          <h2>
            {expenses.length} gastos
            {selected.size > 0 && <span className="muted small"> · {selected.size} marcados ({money(picked.reduce((s, e) => s + e.amount, 0))})</span>}
          </h2>
          <span className="table-head-tools">
            {selected.size > 0 && <button type="button" className="link-button small" onClick={() => setSelected(new Set())}>Desmarcar</button>}
            <button type="button" className={showChart ? "" : "ghost"} aria-pressed={showChart}
              onClick={() => setFilter("grafica", showChart ? "" : "1")}>📊 Gráfica</button>
            <button type="button" onClick={() => setEditing("new")}>+ Nuevo gasto</button>
            <span className="num strong">{money(total)}</span>
          </span>
        </div>
        {showChart && (
          <ExpenseChart expenses={picked} categories={categories} groupBy={groupBy}
            onGroupBy={(g) => setFilter("por", g === "categoria" ? "" : g)}
            scope={selected.size ? `los ${selected.size} gastos marcados` : `los ${expenses.length} gastos de la lista`} />
        )}
        {expenses.length > 0 && (
          <BulkTagger tags={tags} expenses={picked} marked={selected.size > 0}
            onDone={(msg) => { setNotice(msg); loadTags(); load(); }} onCreated={loadTags} />
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="check-col">
                  <input type="checkbox" aria-label="Marcar todos" checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(expenses.map((e) => e.id)))} />
                </th>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Categoría</th>
                <th className="num">Importe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className={`clickable${dropRow === e.id ? " drop-target" : ""}`} onClick={() => setEditing(e)}
                  onDragOver={(ev) => {
                    if (!isTagDrag(ev)) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.dataTransfer.dropEffect = dragging?.from == null ? "copy" : "move";
                    if (dropRow !== e.id) setDropRow(e.id);
                  }}
                  onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDropRow(null); }}
                  onDrop={(ev) => dropOnRow(ev, e.id)}>
                  <td className="check-col" onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" aria-label={`Marcar ${e.description}`} checked={selected.has(e.id)} onChange={() => toggleRow(e.id)} />
                  </td>
                  <td className="nowrap">{date(e.date)}</td>
                  <td>
                    {e.description || "—"}
                    <div className="muted small">
                      <span className={`source-tag source-${e.source}`}>{SOURCE_LABEL[e.source] ?? e.source}</span>
                      {e.provider && e.provider !== e.description && ` · ${e.provider}`}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="tag-list">
                        {e.tags.map((t) => (
                          <span key={t.id} className="draggable" draggable title="Arrastra fuera del gasto para quitarla"
                            onDragStart={(ev) => { startTagDrag(ev, { tagId: t.id, from: e.id }); setDragging({ tagId: t.id, from: e.id }); }}
                            onDragEnd={() => { setDragging(null); setDropRow(null); }}>
                            <TagChip tag={t} />
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{e.category ?? "—"}</td>
                  <td className="num nowrap">{money(e.amount)}</td>
                  <td className="nowrap">
                    <div className="row-tools">
                    {e.reviewed ? (
                      <button type="button" className="flag-btn" title="Marcar para revisar" aria-label="Marcar para revisar"
                        onClick={(ev) => { ev.stopPropagation(); toggleReview(e); }}>⚑</button>
                    ) : (
                      <button type="button" className="badge badge-btn" title="Quitar la marca de revisar"
                        onClick={(ev) => { ev.stopPropagation(); toggleReview(e); }}>⚑ Revisar</button>
                    )}
                    {e.document_id && (
                      <a href={api.documentUrl(e.document_id)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>PDF</a>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr><td colSpan={6} className="muted center">No hay gastos con estos filtros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <ExpenseDialog
          expense={editing === "new" ? null : editing}
          categories={categories}
          tags={tags}
          onTagCreated={loadTags}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg ?? null); loadTags(); load(); }}
        />
      )}
    </div>
    </div>
  );
}

const EMPTY: ExpenseInput = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  description: "",
  provider: null,
  invoice_number: null,
  period_start: null,
  period_end: null,
  category_id: null,
  notes: null,
  reviewed: true,
};

function ExpenseDialog({ expense, categories, tags, onTagCreated, onClose, onSaved }: {
  expense: Expense | null;
  categories: Category[];
  tags: Tag[];
  onTagCreated: () => void;
  onClose: () => void;
  onSaved: (message?: string) => void;
}) {
  const [form, setForm] = useState<ExpenseInput>(() => {
    if (!expense) return { ...EMPTY, tag_ids: [] };
    const { id: _i, category: _c, source: _s, document_id: _d, tags: t, similar_updated: _u, ...rest } = expense;
    // Al guardar, un gasto pendiente queda revisado salvo que se vuelva a marcar
    return { ...rest, reviewed: true, tag_ids: t.map((x) => x.id) };
  });
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>(tags);
  // Gastos del mismo comercio con la misma categoría: al cambiarla, cambian con este
  const [similar, setSimilar] = useState<{ merchant: string; count: number } | null>(null);
  const [applySimilar, setApplySimilar] = useState(true);
  useEffect(() => { if (expense) api.similarExpenses(expense.id).then(setSimilar); }, [expense]);
  useEffect(() => setAllTags(tags), [tags]);
  const categoryChanged = !!expense && form.category_id !== expense.category_id;

  const set = <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (v: string) => (v.trim() === "" ? null : v);
  const id = (v: string) => (v === "" ? null : Number(v));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = form;
    try {
      if (expense) {
        const r = await api.updateExpense(expense.id, body, applySimilar);
        const n = r.similar_updated ?? 0;
        onSaved(n ? `Categoría cambiada también en ${n} ${n === 1 ? "gasto parecido" : "gastos parecidos"} (${similar?.merchant}).` : undefined);
      } else {
        await api.createExpense(body);
        onSaved();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!expense) return;
    await api.deleteExpense(expense.id);
    onSaved();
  };

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    setPdfUrl(null);
    if (!expense?.document_id) return;
    let live = true;
    loadDocumentUrl(expense.document_id).then((u) => { if (live) setPdfUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [expense?.document_id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal card${pdfUrl ? " with-pdf" : ""}`} onClick={(e) => e.stopPropagation()}>
        {pdfUrl && (
          <div className="pdf-pane">
            <iframe className="pdf-frame" src={pdfUrl} title="Factura en PDF" />
            <a className="small" href={pdfUrl} target="_blank" rel="noreferrer">Abrir el PDF en otra pestaña</a>
          </div>
        )}
        <form className="form-pane" onSubmit={save}>
          <h2>{expense ? (expense.reviewed ? "Editar gasto" : "Revisar gasto") : "Nuevo gasto"}</h2>
          {expense && !expense.reviewed && (
            <p className="notice">
              {expense.source === "pdf" ? "Importado automáticamente de un PDF. " : "Marcado para revisar. "}
              {pdfUrl ? "Compara los datos con la factura de al lado" : "Revisa los datos"} y pulsa Confirmar.
            </p>
          )}
          <div className="grid2">
            <label>Fecha<input id="e-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required /></label>
            <label>Importe (€)<input id="e-amount" type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", Number(e.target.value))} required /></label>
            <label className="span2">Descripción<input id="e-desc" value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
            <label className="span2">Categoría
              <select id="e-cat" value={form.category_id ?? ""} onChange={(e) => set("category_id", id(e.target.value))}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {categoryChanged && similar && similar.count > 0 && (
              <label className="span2 check similar-check">
                <input id="e-similar" type="checkbox" checked={applySimilar} onChange={(e) => setApplySimilar(e.target.checked)} />
                Cambiar también {similar.count === 1 ? "el otro gasto" : `los otros ${similar.count} gastos`} de «{similar.merchant}»
                que están en {expense?.category ?? "sin categoría"}
              </label>
            )}
            <label>Proveedor<input id="e-provider" value={form.provider ?? ""} onChange={(e) => set("provider", text(e.target.value))} /></label>
            <label>Nº factura<input id="e-number" value={form.invoice_number ?? ""} onChange={(e) => set("invoice_number", text(e.target.value))} /></label>
            <label>Periodo desde<input id="e-from" type="date" value={form.period_start ?? ""} onChange={(e) => set("period_start", text(e.target.value))} /></label>
            <label>Periodo hasta<input id="e-to" type="date" value={form.period_end ?? ""} onChange={(e) => set("period_end", text(e.target.value))} /></label>
            <div className="span2 field">
              <span>Etiquetas</span>
              <TagPicker tags={allTags} value={form.tag_ids ?? []} onChange={(ids) => set("tag_ids", ids)}
                onCreated={(t) => { setAllTags((l) => [...l, t]); onTagCreated(); }} />
            </div>
            <label className="span2">Notas<textarea id="e-notes" rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", text(e.target.value))} /></label>
          </div>
          <label className="check review-check">
            <input id="e-review" type="checkbox" checked={!form.reviewed} onChange={(e) => set("reviewed", !e.target.checked)} />
            Marcar para revisar <span className="muted small">(aparece en «Pendientes de revisar»; apunta el motivo en Notas)</span>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {expense && <ConfirmButton className="danger" onConfirm={remove} />}
            <span className="push-right" />
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button>{expense && !expense.reviewed && form.reviewed ? "Confirmar" : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Pone o quita una etiqueta a todos los gastos de la lista filtrada
function BulkTagger({ tags, expenses, marked, onDone, onCreated }: {
  tags: Tag[];
  expenses: Expense[];
  marked: boolean; // son los gastos marcados (si no, toda la lista)
  onDone: (message: string) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (remove: boolean) => {
    const text = name.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      if (remove && !tags.some((t) => fold(t.name) === fold(text))) throw new Error(`No existe la etiqueta «${text}»`);
      const { tag, created } = await findOrCreateTag(tags, text);
      if (created) onCreated();
      const r = await api.applyTag(tag.id, expenses.map((e) => e.id), remove);
      onDone(remove
        ? `Etiqueta «${tag.name}» quitada de ${r.changed} gastos.`
        : `Etiqueta «${tag.name}» puesta a ${r.changed} gastos.`);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-tagger">
      <span className="small muted">Etiqueta para los {expenses.length} gastos {marked ? "marcados" : "de la lista"}:</span>
      <input aria-label="Etiqueta" list="bulk-tag-options" placeholder="Trenes, Blablacar…" value={name}
        onChange={(e) => setName(e.target.value)} />
      <datalist id="bulk-tag-options">{tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
      <button type="button" className="ghost" disabled={busy || !name.trim()} onClick={() => run(false)}>Poner</button>
      <button type="button" className="ghost" disabled={busy || !name.trim()} onClick={() => run(true)}>Quitar</button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

// Campo de filtro que espera a que se deje de escribir antes de buscar (no una petición por tecla)
function DebouncedInput({ value, onValue, delay = 350, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onValue: (v: string) => void;
  delay?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onValue(text), delay);
    return () => clearTimeout(t);
  }, [text]);
  return <input {...rest} value={text} onChange={(e) => setText(e.target.value)} />;
}
