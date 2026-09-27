"use client";
import { useFeedbackState } from "@/components/FeedbackProvider";
import { MachineIcon } from "@/components/MachineIcon";
import { SecondWorkerConfirmation } from "@/components/SecondWorkerConfirmation";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitShiftCheckups } from "@/app/actions/checkups";

type Machine = { id: number; code: string; name: string };
export function CheckupForms({ machines, machineRecords, generalRecord, workers, needsConfirmation, shiftStart }: {
  machines: Machine[]; machineRecords: any[]; generalRecord?: any;
  workers: { id: number; name: string }[]; needsConfirmation: boolean; shiftStart: string;
}) {
  const [msg, setMsg] = useFeedbackState("success");
  const [error, setError] = useFeedbackState("error");
  const [allFinalized, setAllFinalized] = useState(generalRecord?.status === "FINALIZED" && machines.every(m => machineRecords.some(r => r.machineId === m.id && r.status === "FINALIZED")));
  const [busy, setBusy] = useState(false);
  const [generalId, setGeneralId] = useState(generalRecord?.id ?? "");
  const [recordIds, setRecordIds] = useState<Record<number, number>>(() => Object.fromEntries(machines.map(m => [m.id, machineRecords.find(r => r.machineId === m.id)?.id])));
  const [openMachines, setOpenMachines] = useState<number[]>(() => machines.filter(m => !machineRecords.some(r => r.machineId === m.id)).map(m => m.id));
  const router = useRouter();
  const inFlight = useRef(false);
  if (!machines.length) return <div className="notice">Não existem máquinas em funcionamento para verificar.</div>;
  return <form className="machine-forms-stack" onSubmit={async event => {
    event.preventDefault();
    if(inFlight.current) return;
    inFlight.current=true;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(form, submitter);
    setMsg(""); setError(""); setBusy(true);
    try {
      const response = await submitShiftCheckups(data);
      if(!response.ok){setError(response.message);return;}
      const result=response.data;
      setGeneralId(result.general.id);
      setAllFinalized(result.finalized);
      setRecordIds(Object.fromEntries(result.machines.map(m => [m.machineId, m.id])));
      setMsg(result.finalized ? "Todas as verificações do turno foram guardadas e finalizadas." : "Rascunho de todas as verificações guardado. Pode completar mais tarde.");
      const pin = form.elements.namedItem("secondWorkerPin") as HTMLInputElement | null;
      if (pin) pin.value = "";
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao guardar as verificações."); }
    finally { inFlight.current=false; setBusy(false); }
  }}>
    <input type="hidden" name="shiftStart" value={shiftStart}/>
    <input type="hidden" name="generalId" value={generalId}/>
    <section className="panel form-stack">
      <h2>Verificação geral do turno</h2>
      <div className="two-col">
        <label>Refrigerador grande (°C)<input name="chillerLargeC" type="number" step="0.1" defaultValue={generalRecord?.chillerLargeC ?? ""}/></label>
        <label>Refrigerador pequeno (°C)<input name="chillerSmallC" type="number" step="0.1" defaultValue={generalRecord?.chillerSmallC ?? ""}/></label>
        <label>Temperatura ambiente da produção (°C)<input name="ambientTempC" type="number" step="0.1" defaultValue={generalRecord?.ambientTempC ?? ""}/></label>
      </div>
      <section className="subpanel">
        {([
          ["cleanDispatch", "Limpeza da zona de expedição"], ["cleanStorage", "Limpeza da zona de armazenamento"], ["cleanProduction", "Limpeza da zona de produção"],
          ["purgePneumaticBarrels", "Purga de barrilotes do ar pneumático"], ["purgeCleanAirBarrels", "Purga de barrilotes do ar limpo"], ["purgeFilters", "Purga de filtros"],
        ] as const).map(([name, label]) => <label className="check" key={name}><input type="checkbox" name={name} defaultChecked={Boolean(generalRecord?.[name])}/>{label}</label>)}
      </section>
      <label>Observações<textarea name="generalNotes" defaultValue={generalRecord?.notes ?? ""}/></label>
    </section>
    {machines.map(machine => {
      const record = machineRecords.find(row => row.machineId === machine.id);
      const open = openMachines.includes(machine.id);
      const prefix = `m${machine.id}_`;
      return <section key={machine.id} className="panel checkup-machine-card">
        <input type="hidden" name="machineIds" value={machine.id}/>
        <input type="hidden" name={prefix + "checkupId"} value={recordIds[machine.id] ?? ""}/>
        <div className="checkup-machine-summary">
          <div className="machine-form-heading"><MachineIcon code={machine.code}/><div><h2>Máquina {machine.code}</h2><p>{machine.name} · {record?.status === "FINALIZED" ? "Finalizada" : recordIds[machine.id] ? "Rascunho gravado" : "Por preencher"}</p></div></div>
          <button type="button" className="btn secondary" aria-expanded={open} aria-controls={`checkup-${machine.id}`} onClick={() => setOpenMachines(current => open ? current.filter(id => id !== machine.id) : [...current, machine.id])}>{open ? "Fechar" : "Abrir / editar"}</button>
        </div>
        <div id={`checkup-${machine.id}`} hidden={!open} className="form-stack checkup-machine-form">
          <section className="subpanel"><div className="two-col">
            <label>Temperatura do óleo hidráulico (°C)<input name={prefix + "oilTempC"} type="number" step="0.1" defaultValue={record?.oilTempC ?? ""}/></label>
            <label>Nível do óleo hidráulico<select name={prefix + "oilLevel"} defaultValue={record?.oilLevel ?? ""}><option value="">Selecione</option><option value="LOW">Baixo</option><option value="NORMAL">Normal</option><option value="HIGH">Alto</option></select></label>
            <label>Pressão de água no sistema (bar)<input name={prefix + "waterPressure"} type="number" step="0.1" min="0" defaultValue={record?.waterPressure ?? ""}/></label>
            <label>Pressão de ar (bar)<input name={prefix + "airPressure"} type="number" step="0.1" min="0" defaultValue={record?.airPressure ?? ""}/></label>
          </div><label className="check"><input type="checkbox" name={prefix + "cleanMachineArea"} defaultChecked={Boolean(record?.cleanMachineArea)}/>Limpeza de aparadeiras, tapetes e mesa de embalamento</label></section>
          <label>Observações<textarea name={prefix + "notes"} defaultValue={record?.notes ?? ""}/></label>
        </div>
      </section>;
    })}
    <section className="panel form-stack">
      <h2>Concluir verificações do turno</h2>
      <p className="muted">Grave todas as verificações em conjunto. Pode alterar os registos até ao fim do turno.</p>
      {needsConfirmation && <SecondWorkerConfirmation workers={workers}/>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {msg && <div className="alert success" role="status">{msg}</div>}
      <div className="button-row">
        {!allFinalized && <button className="btn secondary" name="intent" value="draft" formNoValidate disabled={busy}>Gravar rascunho</button>}
        <button className="btn primary" name="intent" value="finalize" disabled={busy}>{busy ? "A guardar…" : allFinalized ? "Guardar alterações" : "Finalizar verificações do turno"}</button>
      </div>
    </section>
  </form>;
}
