"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGeneralCheck, saveMachineCheckup } from "@/app/actions/checkups";

type Machine = { id: number; code: string; name: string };

export function CheckupForms({ machines, machineRecords, generalRecord }: { machines: Machine[]; machineRecords: any[]; generalRecord?: any }) {
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const run = async (fd: FormData, general = false) => {
    setMsg(""); setError("");
    if (fd.get("intent") === "finalize" && !confirm("Finalizar esta verificação de turno?")) return;
    try {
      const r = general ? await saveGeneralCheck(fd) : await saveMachineCheckup(fd);
      setMsg(r.finalized ? "Verificação finalizada." : "Rascunho gravado. Pode completar mais tarde.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao guardar."); }
  };
  return <div className="machine-forms-stack">
    <form action={(fd) => run(fd, true)} className="panel form-stack">
      <input type="hidden" name="generalId" value={generalRecord?.status === "DRAFT" ? generalRecord.id : ""}/>
      <h2>Verificação geral do turno</h2>
      {generalRecord?.status === "FINALIZED" ? <div className="notice">A verificação geral deste turno já foi finalizada.</div> : <>
        <div className="two-col">
          <label>Refrigerador grande (°C)<input name="chillerLargeC" type="number" step="0.1" defaultValue={generalRecord?.chillerLargeC ?? ""}/></label>
          <label>Refrigerador pequeno (°C)<input name="chillerSmallC" type="number" step="0.1" defaultValue={generalRecord?.chillerSmallC ?? ""}/></label>
          <label>Temperatura ambiente da produção (°C)<input name="ambientTempC" type="number" step="0.1" defaultValue={generalRecord?.ambientTempC ?? ""}/></label>
        </div>
        <section className="subpanel"><label className="check"><input type="checkbox" name="cleanDispatch" defaultChecked={generalRecord?.cleanDispatch}/>Limpeza da zona de expedição</label><label className="check"><input type="checkbox" name="cleanStorage" defaultChecked={generalRecord?.cleanStorage}/>Limpeza da zona de armazenamento</label><label className="check"><input type="checkbox" name="cleanProduction" defaultChecked={generalRecord?.cleanProduction}/>Limpeza da zona de produção</label></section>
        <label>Observações<textarea name="generalNotes" defaultValue={generalRecord?.notes ?? ""}/></label>
        <div className="button-row"><button className="btn secondary" name="intent" value="draft" formNoValidate>Gravar rascunho</button><button className="btn primary" name="intent" value="finalize">Finalizar verificação geral</button></div>
      </>}
    </form>

    {machines.map((machine) => {
      const record = machineRecords.find((row) => row.machineId === machine.id);
      return <form key={machine.id} action={(fd) => run(fd)} className="panel form-stack">
        <input type="hidden" name="machineId" value={machine.id}/>
        <input type="hidden" name="checkupId" value={record?.status === "DRAFT" ? record.id : ""}/>
        <div className="machine-form-heading"><img src={["5", "6"].includes(machine.code) ? "/maq-tampas.png" : "/maq-garrafoes.png"} alt=""/><div><h2>Máquina {machine.code}</h2><p>{machine.name}</p></div></div>
        {record?.status === "FINALIZED" ? <div className="notice">A verificação desta máquina já foi finalizada neste turno.</div> : <>
          <section className="subpanel"><div className="two-col">
            <label>Temperatura do óleo hidráulico (°C)<input name="oilTempC" type="number" step="0.1" defaultValue={record?.oilTempC ?? ""}/></label>
            <label>Nível do óleo hidráulico<select name="oilLevel" defaultValue={record?.oilLevel ?? ""}><option value="">Selecione</option><option value="LOW">Baixo</option><option value="NORMAL">Normal</option><option value="HIGH">Alto</option></select></label>
            <label>Pressão de água no sistema (bar)<input name="waterPressure" type="number" step="0.1" min="0" defaultValue={record?.waterPressure ?? ""}/></label>
            <label>Pressão de ar (bar)<input name="airPressure" type="number" step="0.1" min="0" defaultValue={record?.airPressure ?? ""}/></label>
          </div><label className="check"><input type="checkbox" name="cleanMachineArea" defaultChecked={record?.cleanMachineArea}/>Limpeza de aparadeiras, tapetes e mesa de embalamento</label></section>
          <section className="subpanel breakdown-panel"><h3>Avarias / paragens</h3><label className="check"><input type="checkbox" name="hasBreakdown" defaultChecked={record?.hasBreakdown}/>Foi detetada uma avaria ou paragem</label><label className="check"><input type="checkbox" name="breakdownStoppedMachine" defaultChecked={record?.breakdownStoppedMachine}/>A máquina ficou parada</label><label>Descrição da avaria<textarea name="breakdownDescription" defaultValue={record?.breakdownDescription ?? ""} placeholder="Descreva o problema, quando ocorreu e o que foi observado."/></label></section><label>Observações<textarea name="notes" defaultValue={record?.notes ?? ""}/></label>
          <div className="button-row"><button className="btn secondary" name="intent" value="draft" formNoValidate>Gravar rascunho</button><button className="btn primary" name="intent" value="finalize">Finalizar verificação</button></div>
        </>}
      </form>;
    })}
    {error && <div className="alert error">{error}</div>}{msg && <div className="alert success">{msg}</div>}
  </div>;
}
