"use client";
import { MachineIcon } from "@/components/MachineIcon";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGeneralCheck, saveMachineCheckup } from "@/app/actions/checkups";

type Machine = { id: number; code: string; name: string };

export function CheckupForms({ machines, machineRecords, generalRecord }: { machines: Machine[]; machineRecords: any[]; generalRecord?: any }) {
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [openMachines, setOpenMachines] = useState<number[]>(() =>
    machines.filter((machine) => !machineRecords.some((row) => row.machineId === machine.id)).map((machine) => machine.id),
  );
  const router = useRouter();

  const setMachineOpen = (machineId: number, open: boolean) => {
    setOpenMachines((current) => open
      ? current.includes(machineId) ? current : [...current, machineId]
      : current.filter((id) => id !== machineId));
  };

  const run = async (fd: FormData, general = false) => {
    setMsg(""); setError("");
    if (fd.get("intent") === "finalize" && !confirm("Finalizar esta verificação de turno? Poderá alterá-la até ao fim do turno.")) return;
    try {
      const r = general ? await saveGeneralCheck(fd) : await saveMachineCheckup(fd);
      setMsg(r.finalized ? "Verificação guardada. Pode ser alterada até ao fim do turno." : "Rascunho gravado. Pode completar mais tarde.");
      if (!general) {
        const machineId = Number(fd.get("machineId"));
        if (machineId) setMachineOpen(machineId, false);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao guardar.");
    }
  };

  return <div className="machine-forms-stack">
    <form action={(fd) => run(fd, true)} className="panel form-stack">
      <input type="hidden" name="generalId" value={generalRecord?.id ?? ""}/>
      <h2>Verificação geral do turno</h2>
      {generalRecord?.status === "FINALIZED" && <div className="notice">Esta verificação está finalizada, mas pode ser alterada enquanto o turno estiver a decorrer.</div>}
      <div className="two-col">
        <label>Refrigerador grande (°C)<input name="chillerLargeC" type="number" step="0.1" defaultValue={generalRecord?.chillerLargeC ?? ""}/></label>
        <label>Refrigerador pequeno (°C)<input name="chillerSmallC" type="number" step="0.1" defaultValue={generalRecord?.chillerSmallC ?? ""}/></label>
        <label>Temperatura ambiente da produção (°C)<input name="ambientTempC" type="number" step="0.1" defaultValue={generalRecord?.ambientTempC ?? ""}/></label>
      </div>
      <section className="subpanel">
        <label className="check"><input type="checkbox" name="cleanDispatch" defaultChecked={generalRecord?.cleanDispatch}/>Limpeza da zona de expedição</label>
        <label className="check"><input type="checkbox" name="cleanStorage" defaultChecked={generalRecord?.cleanStorage}/>Limpeza da zona de armazenamento</label>
        <label className="check"><input type="checkbox" name="cleanProduction" defaultChecked={generalRecord?.cleanProduction}/>Limpeza da zona de produção</label>
      </section>
      <label>Observações<textarea name="generalNotes" defaultValue={generalRecord?.notes ?? ""}/></label>
      <div className="button-row">
        {generalRecord?.status !== "FINALIZED" && <button className="btn secondary" name="intent" value="draft" formNoValidate>Gravar rascunho</button>}
        <button className="btn primary" name="intent" value="finalize">{generalRecord?.status === "FINALIZED" ? "Guardar alterações" : "Finalizar verificação geral"}</button>
      </div>
    </form>

    {machines.map((machine) => {
      const record = machineRecords.find((row) => row.machineId === machine.id);
      const open = openMachines.includes(machine.id);
      const stateLabel = record?.status === "FINALIZED" ? "Finalizada" : record ? "Rascunho gravado" : "Por preencher";

      return <section key={machine.id} className="panel checkup-machine-card">
        <div className="checkup-machine-summary">
          <div className="machine-form-heading">
            <MachineIcon code={machine.code}/>
            <div><h2>Máquina {machine.code}</h2><p>{machine.name} · {stateLabel}</p></div>
          </div>
          <button type="button" className="btn secondary" onClick={() => setMachineOpen(machine.id, !open)}>
            {open ? "Fechar" : record ? "Abrir / editar" : "Preencher"}
          </button>
        </div>

        {open && <form action={(fd) => run(fd)} className="form-stack checkup-machine-form">
          <input type="hidden" name="machineId" value={machine.id}/>
          <input type="hidden" name="checkupId" value={record?.id ?? ""}/>
          {record?.status === "FINALIZED" && <div className="notice">Esta verificação está finalizada, mas pode ser alterada enquanto o turno estiver a decorrer.</div>}
          <section className="subpanel"><div className="two-col">
            <label>Temperatura do óleo hidráulico (°C)<input name="oilTempC" type="number" step="0.1" defaultValue={record?.oilTempC ?? ""}/></label>
            <label>Nível do óleo hidráulico<select name="oilLevel" defaultValue={record?.oilLevel ?? ""}><option value="">Selecione</option><option value="LOW">Baixo</option><option value="NORMAL">Normal</option><option value="HIGH">Alto</option></select></label>
            <label>Pressão de água no sistema (bar)<input name="waterPressure" type="number" step="0.1" min="0" defaultValue={record?.waterPressure ?? ""}/></label>
            <label>Pressão de ar (bar)<input name="airPressure" type="number" step="0.1" min="0" defaultValue={record?.airPressure ?? ""}/></label>
          </div><label className="check"><input type="checkbox" name="cleanMachineArea" defaultChecked={record?.cleanMachineArea}/>Limpeza de aparadeiras, tapetes e mesa de embalamento</label></section>
          <label>Observações<textarea name="notes" defaultValue={record?.notes ?? ""}/></label>
          <div className="button-row">
            {record?.status !== "FINALIZED" && <button className="btn secondary" name="intent" value="draft" formNoValidate>Gravar rascunho</button>}
            <button className="btn primary" name="intent" value="finalize">{record?.status === "FINALIZED" ? "Guardar alterações" : "Finalizar verificação"}</button>
          </div>
        </form>}
      </section>;
    })}
    {error && <div className="alert error">{error}</div>}
    {msg && <div className="alert success">{msg}</div>}
  </div>;
}
