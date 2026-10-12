import { useSearchParams } from "react-router-dom";
import BankImport from "./BankImport";
import Upload from "./Upload";

// Una sola pestaña para meter datos: facturas en PDF o movimientos del banco en Excel
export default function Import() {
  const [params, setParams] = useSearchParams();
  const pdf = params.get("tipo") === "pdf";
  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Qué importar">
        <button type="button" role="tab" aria-selected={!pdf} className={pdf ? "tab" : "tab active"}
          onClick={() => setParams({}, { replace: true })}>Excel del banco</button>
        <button type="button" role="tab" aria-selected={pdf} className={pdf ? "tab active" : "tab"}
          onClick={() => setParams({ tipo: "pdf" }, { replace: true })}>Facturas en PDF</button>
      </div>
      {pdf ? <Upload /> : <BankImport />}
    </div>
  );
}
