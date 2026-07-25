"use client";
export function ConfirmDeleteButton({ label = "Eliminar", message = "Tem a certeza de que pretende eliminar este registo?" }: { label?: string; message?: string }) {
  return <button className="btn danger-btn" type="submit" onClick={(event) => { if (!confirm(message)) event.preventDefault(); }}>{label}</button>;
}
