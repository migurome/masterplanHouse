import { useState } from "react";

// Botón de borrado con confirmación dentro de la página (sin confirm() del navegador)
export default function ConfirmButton({
  label = "Borrar", question = "¿Seguro?", confirmLabel = "Sí, borrar", onConfirm, className = "ghost danger",
}: {
  label?: string;
  question?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className={className} onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <span className="confirm">
      <span className="small">{question}</span>
      <button type="button" className="danger" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="ghost" onClick={() => setAsking(false)}>No</button>
    </span>
  );
}
