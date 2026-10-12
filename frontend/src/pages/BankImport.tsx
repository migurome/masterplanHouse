import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, BankMovement, BankPreview, Category, RegisteredExpense } from "../api";
import ImportHistory from "../components/ImportHistory";
import { date, money } from "../format";

// Importación de movimientos bancarios desde Excel. Nada se guarda hasta dar OK a un movimiento o
// importar los seleccionados. Además se cotejan los recibos con las facturas registradas.

const KIND_HELP: Record<string, string> = {
  "Pagos con tarjeta": "Compras con tarjeta de débito o crédito",
  "Recibos domiciliados": "Adeudos: luz, internet, agua, alquiler, seguros…",
  "Traspasos entre cuentas": "Dinero que pasa de una cuenta tuya a otra",
  "Transferencias": "Transferencias enviadas y recibidas",
  "Retiradas de efectivo": "Dinero sacado del cajero",
  "Bizum": "Pagos por Bizum",
  "Ingresos y devoluciones": "Entradas de dinero: nóminas, devoluciones… nunca son gasto",
};

type Tab = "pendientes" | "importados" | "todos";
type Check = "" | "cuadra" | "no-cuadra" | "hueco" | "sin-factura";

const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
  "octubre", "noviembre", "diciembre"];
const monthName = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function checkOf(m: BankMovement): Check {
  if (m.status === "duplicado") return "cuadra";
  if (m.mismatch) return "no-cuadra";
  if (m.fills_gap) return "hueco";
  if (m.kind === "Recibos domiciliados" && m.amount < 0) return "sin-factura";
  return "";
}

function CheckNote({ m }: { m: BankMovement }) {
  if (m.status === "importado") return <div className="small muted">Ya importado</div>;
  if (m.amount >= 0) return <div className="small income">Ingreso · {m.income_kind}</div>;
  if (m.status === "duplicado" && m.duplicate_of) {
    return <div className="small check-ok">✓ Cuadra con {m.duplicate_of.description} del {date(m.duplicate_of.date)}{m.duplicate_of.has_pdf && " (PDF)"}</div>;
  }
  if (m.mismatch) {
    const diff = -m.amount - m.mismatch.amount;
    return (
      <div className="small warn-text">
        ⚠ No cuadra con {m.mismatch.description} del {date(m.mismatch.date)}: factura {money(m.mismatch.amount)},
        banco {money(-m.amount)} ({diff > 0 ? "+" : ""}{money(diff)})
      </div>
    );
  }
  if (m.fills_gap) {
    const g = m.fills_gap;
    return (
      <div className="small check-gap">
        ＋ Rellena el hueco de {g.category}
        {g.period_from && g.period_to ? ` del ${date(g.period_from)} al ${date(g.period_to)}` : ` de ${monthName(g.month)}`}
      </div>
    );
  }
  if (m.kind === "Recibos domiciliados") return <div className="small muted">Recibo sin factura registrada</div>;
  return null;
}

export default function BankImport() {
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [excludedIncome, setExcludedIncome] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [chosenCat, setChosenCat] = useState<Map<string, string>>(new Map());
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("pendientes");
  const [kindFilter, setKindFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [check, setCheck] = useState<Check>("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  // Cada análisis del Excel es una sesión: lo importado desde él se puede deshacer junto
  const [session, setSession] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api.categories().then(setCategories); }, []);

  const analyze = async (files: FileList | File[]) => {
    const xlsx = Array.from(files).filter((f) => /\.xlsx$/i.test(f.name));
    if (xlsx.length === 0) {
      setError("Elige archivos Excel (.xlsx) exportados del banco.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const p = await api.bankPreview(xlsx);
      setPreview(p);
      setSession(Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      setExcluded(new Set(p.excluded_kinds));
      setExcludedIncome(new Set(p.excluded_income_kinds));
      setOverrides(new Map());
      setChosenCat(new Map());
      setImported(new Set());
      setTab("pendientes");
      setCheck("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const movements = preview?.movements ?? [];
  const isImported = (m: BankMovement) => m.status === "importado" || imported.has(m.key);
  const canImport = (m: BankMovement) => m.importable && !isImported(m);
  // Preselección: tipo incluido y sin factura registrada (los que no cuadran se revisan a mano)
  // Lo que entra: según su tipo de ingreso; lo que sale: tipo incluido y sin factura registrada
  const preselected = (m: BankMovement) => m.amount > 0
    ? !!m.income_kind && !excludedIncome.has(m.income_kind)
    : m.status !== "duplicado" && !m.mismatch && !excluded.has(m.kind);
  const isSelected = (m: BankMovement) => canImport(m) && (overrides.get(m.key) ?? preselected(m));
  const categoryOf = (m: BankMovement) => chosenCat.get(m.key) ?? m.category ?? "Otros";

  const toggleKind = (name: string) => {
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExcluded(next);
    // El tipo manda: se olvidan las marcas sueltas de sus movimientos
    const o = new Map(overrides);
    movements.forEach((m) => m.amount < 0 && m.kind === name && o.delete(m.key));
    setOverrides(o);
  };

  const toggleIncomeKind = (name: string) => {
    const next = new Set(excludedIncome);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExcludedIncome(next);
    const o = new Map(overrides);
    movements.forEach((m) => m.income_kind === name && o.delete(m.key));
    setOverrides(o);
  };

  // Cambiar la categoría de un movimiento la cambia en todos los del mismo comercio pendientes
  const setCategory = (m: BankMovement, value: string) => {
    const similar = movements.filter((x) => x.group === m.group && canImport(x));
    const next = new Map(chosenCat);
    similar.forEach((x) => next.set(x.key, value));
    next.set(m.key, value);
    setChosenCat(next);
    setNotice(similar.length > 1 ? `«${value}» aplicada a ${similar.length} movimientos de ${m.group}.` : "");
  };

  const categoryNames = useMemo(() => {
    const names = categories.map((c) => c.name);
    const extra = [...new Set(movements.map((m) => m.category).filter((c): c is string => !!c && !names.includes(c)))];
    return { names, extra };
  }, [categories, movements]);

  const kinds = preview?.kinds.map((k) => k.name) ?? [];
  const visible = movements.filter((m) => {
    if (tab === "pendientes" && isImported(m)) return false;
    if (tab === "importados" && !isImported(m)) return false;
    if (kindFilter && m.kind !== kindFilter) return false;
    if (catFilter && (m.amount >= 0 || categoryOf(m) !== catFilter)) return false;
    if (check && checkOf(m) !== check) return false;
    if (!search.trim()) return true;
    const text = `${m.concept} ${m.detail} ${m.notes} ${m.kind} ${categoryOf(m)}`.toLowerCase();
    return search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
  });
  const visibleImportable = visible.filter(canImport);
  const selected = movements.filter(isSelected);
  const selectedExpenses = selected.filter((m) => m.amount < 0);
  const selectedIncomes = selected.filter((m) => m.amount > 0);
  const selectedTotal = selectedExpenses.reduce((s, m) => s - m.amount, 0);
  const selectedIncomeTotal = selectedIncomes.reduce((s, m) => s + m.amount, 0);
  const allVisibleSelected = visibleImportable.length > 0 && visibleImportable.every(isSelected);

  const selectVisible = (on: boolean) => {
    const o = new Map(overrides);
    visibleImportable.forEach((m) => o.set(m.key, on));
    setOverrides(o);
  };

  const importRows = async (rows: BankMovement[]) => {
    if (rows.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.bankImport(
        rows.map((m) => ({
          key: m.key, date: m.date, amount: Math.abs(m.amount),
          direction: m.amount > 0 ? "ingreso" as const : "gasto" as const, income_kind: m.income_kind,
          // En un ingreso el concepto del banco es genérico ("Transferencia recibida"): se usa el texto libre
          description: m.amount > 0 && m.detail ? m.detail : m.concept,
          category: m.amount > 0 ? null : categoryOf(m),
          notes: [m.detail, m.notes].filter(Boolean).join(" · ") || null, group: m.group,
          period_start: m.fills_gap?.period_from ?? null, period_end: m.fills_gap?.period_to ?? null,
        })),
        [...excluded],
        [...excludedIncome],
        session,
      );
      setImported(new Set([...imported, ...r.keys]));
      setHistoryTick((t) => t + 1);
      setNotice(`Importados ${r.imported} movimientos${r.skipped ? ` (${r.skipped} ya estaban)` : ""}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    analyze(e.dataTransfer.files);
  };

  const counts = {
    cuadra: movements.filter((m) => checkOf(m) === "cuadra").length,
    noCuadra: movements.filter((m) => checkOf(m) === "no-cuadra").length,
    hueco: movements.filter((m) => checkOf(m) === "hueco" && !isImported(m)).length,
    sinFactura: movements.filter((m) => checkOf(m) === "sin-factura" && !isImported(m)).length,
  };
  const showCheck = (c: Check) => {
    setCheck(c);
    setTab("todos");
    document.getElementById("movimientos")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="stack">
      <section
        className={`card dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && input.current?.click()}
      >
        <input ref={input} type="file" accept=".xlsx" multiple hidden
          onChange={(e) => { if (e.target.files) analyze(e.target.files); e.target.value = ""; }} />
        <h2>{busy && !preview ? "Leyendo movimientos…" : "Arrastra aquí el Excel de movimientos del banco"}</h2>
        <p className="muted">
          o haz clic para elegirlo (.xlsx, puedes elegir varios). Nada se guarda hasta que des OK a un
          movimiento o importes los seleccionados.
        </p>
      </section>

      {error && <p className="error">{error}</p>}

      <ImportHistory refresh={historyTick} onUndone={(deleted) => {
        setNotice(`Deshecho: se han borrado ${deleted} gastos.${preview ? " Vuelve a subir el Excel para ver sus movimientos como pendientes." : ""}`);
        setPreview(null);
        setImported(new Set());
      }} />
      {notice && !preview && <p className="notice small" role="status">{notice}</p>}

      {preview && (
        <>
          <section className="card">
            <h2>Cotejo con las facturas</h2>
            <p className="muted small section-sub">
              Los recibos del banco comparados con los gastos registrados (facturas en PDF y gastos a mano).
              Pulsa un recuadro para ver sus movimientos.
            </p>
            <div className="check-tiles">
              <button type="button" className="check-tile ok" onClick={() => showCheck("cuadra")}>
                <span className="tile-value">{counts.cuadra}</span>
                <span>cuadran con su factura</span>
              </button>
              <button type="button" className="check-tile warn" onClick={() => showCheck("no-cuadra")}>
                <span className="tile-value">{counts.noCuadra}</span>
                <span>no cuadran: importe distinto</span>
              </button>
              <button type="button" className="check-tile gap" onClick={() => showCheck("hueco")}>
                <span className="tile-value">{counts.hueco}</span>
                <span>rellenan huecos de facturas</span>
              </button>
              <button type="button" className="check-tile" onClick={() => showCheck("sin-factura")}>
                <span className="tile-value">{counts.sinFactura}</span>
                <span>recibos sin factura</span>
              </button>
            </div>
            <UnmatchedInvoices items={preview.unmatched_invoices} />
          </section>

          <section className="card">
            <h2>Tipos de gasto (lo que sale)</h2>
            <p className="muted small section-sub">
              Desmarca los tipos que no son gastos de la casa: sus movimientos dejan de estar seleccionados.
              La elección se recuerda. {preview.files.map((f) => `${f.name}: ${f.movements} movimientos`).join(" · ")}
            </p>
            <div className="table-scroll">
              <table className="kinds">
                <thead>
                  <tr><th>Incluir</th><th>Tipo</th><th className="num">Movimientos</th><th className="num">Importe</th><th className="num">Seleccionados</th></tr>
                </thead>
                <tbody>
                  {preview.kinds.map((k) => (
                    <tr key={k.name} className={excluded.has(k.name) ? "off" : ""}>
                      <td>
                        <input type="checkbox" aria-label={`Incluir ${k.name}`} checked={!excluded.has(k.name)}
                          onChange={() => toggleKind(k.name)} />
                      </td>
                      <td>
                        <div className="strong">{k.name}</div>
                        {KIND_HELP[k.name] && <div className="muted small">{KIND_HELP[k.name]}</div>}
                      </td>
                      <td className="num">{k.count}</td>
                      <td className="num">{money(k.total)}</td>
                      <td className="num">{movements.filter((m) => m.amount < 0 && m.kind === k.name && isSelected(m)).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {preview.income_kinds.length > 0 && (
            <section className="card">
              <h2>Tipos de ingreso (lo que entra)</h2>
              <p className="muted small section-sub">
                Los ingresos de la cuenta cuentan para la capacidad de ahorro de la unidad familiar (pestaña Ahorro).
                Las devoluciones de compras vienen desmarcadas: no son ingresos.
              </p>
              <div className="table-scroll">
                <table className="kinds">
                  <thead>
                    <tr><th>Incluir</th><th>Tipo</th><th className="num">Movimientos</th><th className="num">Importe</th><th className="num">Seleccionados</th></tr>
                  </thead>
                  <tbody>
                    {preview.income_kinds.map((k) => (
                      <tr key={k.name} className={excludedIncome.has(k.name) ? "off" : ""}>
                        <td>
                          <input type="checkbox" aria-label={`Incluir ${k.name}`} checked={!excludedIncome.has(k.name)}
                            onChange={() => toggleIncomeKind(k.name)} />
                        </td>
                        <td><div className="strong">{k.name}</div></td>
                        <td className="num">{k.count}</td>
                        <td className="num income">{money(k.total)}</td>
                        <td className="num">{movements.filter((m) => m.income_kind === k.name && isSelected(m)).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card" id="movimientos">
            <h2>Movimientos</h2>
            <p className="muted small section-sub">
              Da OK a un movimiento para importarlo ya, o selecciona varios e impórtalos juntos. Al cambiar la
              categoría de un comercio se cambia en todos sus movimientos.
            </p>
            <div className="filters">
              <div className="tabs" role="tablist">
                {([
                  ["pendientes", `Pendientes (${movements.filter((m) => !isImported(m)).length})`],
                  ["importados", `Importados (${movements.filter(isImported).length})`],
                  ["todos", `Todos (${movements.length})`],
                ] as [Tab, string][]).map(([t, label]) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t}
                    className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="filters bank-filters">
              <label>
                Tipo
                <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                  <option value="">Todos</option>
                  {kinds.map((k) => <option key={k}>{k}</option>)}
                </select>
              </label>
              <label>
                Categoría
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                  <option value="">Todas</option>
                  {[...categoryNames.names, ...categoryNames.extra].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label>
                Cotejo
                <select value={check} onChange={(e) => setCheck(e.target.value as Check)}>
                  <option value="">Todos</option>
                  <option value="cuadra">Cuadran con factura</option>
                  <option value="no-cuadra">No cuadran</option>
                  <option value="hueco">Rellenan huecos</option>
                  <option value="sin-factura">Recibos sin factura</option>
                </select>
              </label>
              <label className="grow">
                Buscar palabras
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="mercadona, renfe…" />
              </label>
              {(kindFilter || catFilter || check || search) && (
                <button type="button" className="link-button small" onClick={() => {
                  setKindFilter(""); setCatFilter(""); setCheck(""); setSearch("");
                }}>Quitar filtros</button>
              )}
            </div>
            {notice && <p className="notice small" role="status">{notice}</p>}
            <div className="table-scroll">
              <table className="movements">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="Seleccionar todos los visibles" checked={allVisibleSelected}
                        disabled={visibleImportable.length === 0} onChange={(e) => selectVisible(e.target.checked)} />
                    </th>
                    <th>Fecha</th><th>Concepto</th><th>Categoría</th><th className="num">Importe</th><th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    const done = isImported(m);
                    return (
                      <tr key={m.key} className={done ? "done" : isSelected(m) ? "" : "off"}>
                        <td>
                          <input type="checkbox" checked={isSelected(m)} disabled={!canImport(m)}
                            aria-label={`Seleccionar ${m.concept}`}
                            onChange={() => setOverrides(new Map(overrides).set(m.key, !isSelected(m)))} />
                        </td>
                        <td className="nowrap">{date(m.date)}</td>
                        <td>
                          <div>{m.concept}</div>
                          <div className="muted small">
                            {m.kind}{m.detail && m.detail !== "Pago con tarjeta" && !m.detail.startsWith("Adeudo nº") && ` · ${m.detail}`}
                          </div>
                          <CheckNote m={m} />
                        </td>
                        <td>
                          {m.amount > 0 ? <span className="small income">{m.income_kind}</span> : canImport(m) ? (
                            <select value={categoryOf(m)} aria-label="Categoría" onChange={(e) => setCategory(m, e.target.value)}>
                              {categoryNames.names.map((n) => <option key={n}>{n}</option>)}
                              {categoryNames.extra.map((n) => <option key={n} value={n}>{n} (nueva)</option>)}
                            </select>
                          ) : <span className="muted small">{done ? categoryOf(m) : "—"}</span>}
                        </td>
                        <td className={`num nowrap ${m.amount > 0 ? "income" : ""}`}>{money(m.amount)}</td>
                        <td>
                          {done ? <span className="check-ok small nowrap">✓ Importado</span>
                            : canImport(m) && (
                              <button type="button" className="ghost small-button" disabled={busy}
                                onClick={() => importRows([m])} aria-label={`Importar ${m.concept}`}>OK</button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr><td colSpan={6} className="muted">No hay movimientos con estos filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="import-bar card">
            <span>
              Seleccionados: <strong>{selectedExpenses.length}</strong> gastos · <strong>{money(selectedTotal)}</strong>
              {selectedIncomes.length > 0 && <> · <strong>{selectedIncomes.length}</strong> ingresos · <strong className="income">{money(selectedIncomeTotal)}</strong></>}
              {imported.size > 0 && <span className="muted"> · {imported.size} importados en esta sesión</span>}
            </span>
            {imported.size > 0 && <Link to="/gastos" className="button ghost">Ver gastos</Link>}
            <button type="button" onClick={() => importRows(selected)} disabled={busy || selected.length === 0}>
              {busy ? "Importando…" : `Importar ${selected.length} seleccionados`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UnmatchedInvoices({ items }: { items: RegisteredExpense[] }) {
  if (items.length === 0) return null;
  return (
    <details className="table-view">
      <summary>{items.length} facturas registradas sin cargo en el banco en las fechas del Excel</summary>
      <ul className="unmatched">
        {items.map((e) => (
          <li key={e.id}>
            <span className="nowrap">{date(e.date)}</span>
            <span>{e.category} · {e.description}</span>
            <span className="num">{money(e.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Puede que se pagaran desde otra cuenta o que el cargo llegue más tarde.</p>
    </details>
  );
}
