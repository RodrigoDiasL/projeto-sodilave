"use client";
import { useFeedbackState } from "@/components/FeedbackProvider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveOperationSettings } from "@/app/actions/operation-settings";

export function OperationSettingsForm({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFeedbackState("success");
  const [error, setError] = useFeedbackState("error");
  const router = useRouter();
  return <form className="panel form-stack" onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await saveOperationSettings(data);
      setChecked(result.enabled);
      setMessage(result.enabled ? "Registo de produção passada ativado." : "Registo de produção passada desativado.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível guardar."); }
    finally { setBusy(false); }
  }}>
    <h2>Registo de produção passada</h2>
    <p>Permite aos colaboradores, responsáveis de produção e administradores escolher um dia e um turno já terminado. Útil para inserir os dados recolhidos antes da utilização da aplicação.</p>
    <label className="check"><input type="checkbox" name="pastProductionEnabled" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy}/>Permitir registo de produção passada</label>
    <p className="muted">Ao desativar, deixa de ser possível criar ou concluir rascunhos de turnos passados. Os registos já guardados continuam disponíveis para consulta.</p>
    <button className="btn primary" disabled={busy}>{busy ? "A guardar…" : "Guardar definições"}</button>
    {error && <p className="alert error" role="alert">{error}</p>}
    {message && <p className="alert success" role="status">{message}</p>}
  </form>;
}
