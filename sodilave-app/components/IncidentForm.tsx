"use client";

import { useState } from "react";
import { registerIncident } from "@/app/actions/incidents";

type Machine = { id: number; code: string; name: string; status: "RUNNING" | "STOPPED" };

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function IncidentForm({ machines }: { machines: Machine[] }) {
  const [occurredAt, setOccurredAt] = useState("");

  return <form action={registerIncident} className="form-stack">
    <div className="two-col">
      <label>Máquina<select name="machineId" required><option value="">Selecione</option>{machines.map(m=><option key={m.id} value={m.id}>Máquina {m.code} — {m.name} ({m.status==="RUNNING"?"em funcionamento":"parada"})</option>)}</select></label>
      <label>Tipo<select name="type" defaultValue="BREAKDOWN"><option value="BREAKDOWN">Avaria</option><option value="STOPPAGE">Paragem</option><option value="OTHER">Outra ocorrência</option></select></label>
      <label>Data e hora<div className="datetime-now-row"><input name="occurredAt" type="datetime-local" value={occurredAt} onChange={(e)=>setOccurredAt(e.target.value)}/><button type="button" className="btn secondary" onClick={()=>setOccurredAt(localDateTimeValue())}>Agora</button></div></label>
      <label className="check"><input type="checkbox" name="stoppedMachine" defaultChecked/>A máquina ficou parada</label>
    </div>
    <label>Descrição da ocorrência<textarea name="description" required placeholder="Descreva o problema, o momento em que ocorreu e as pessoas envolvidas."/></label>
    <button className="btn primary">Registar ocorrência</button>
  </form>;
}
