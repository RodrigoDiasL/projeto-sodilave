"use client";
import { useFeedback, useFeedbackState } from "@/components/FeedbackProvider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDisplayDevice, revokeDisplayDevice, saveDisplayOrder } from "@/app/actions/production-display";

type Machine={id:number;code:string;commercialLotId:number|null;destination:string|null;notes:string|null;currentOrder:number};
type Lot={id:number;code:string;product:string;machineId:number};
type Device={id:string;name:string;paired:boolean;expiresAt:string|null;pairingExpiresAt:string};
function OrderForm({machine,lots,enabled}:{machine:Machine;lots:Lot[];enabled:boolean}) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const notify=useFeedback();
  return <form className="panel form-stack" onSubmit={async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);setBusy(true);setMessage("");
    try {await saveDisplayOrder(fd);setMessage("Ordem guardada. O ecrã atualiza em até 10 segundos.");notify("success","Ordem de paletização guardada.");router.refresh();}
    catch(e){const message=e instanceof Error?e.message:"Não foi possível guardar.";setMessage(message);notify("error",message);}finally{setBusy(false);}
  }}><h2>Máquina {machine.code}</h2><input type="hidden" name="machineId" value={machine.id}/>
    <label>Produto / lote comercial<select name="commercialLotId" defaultValue={machine.currentOrder?machine.commercialLotId??"":""} required disabled={!enabled||busy}>
      <option value="">Selecione o lote ativo</option>{lots.filter(l=>l.machineId===machine.id).map(l=><option key={l.id} value={l.id}>{l.product} · {l.code}</option>)}
    </select></label><label>Destino das embalagens<select name="destination" defaultValue={machine.currentOrder?machine.destination??"":""} required disabled={!enabled||busy}><option value="">Selecione</option><option value="PALLET">Paletes</option><option value="STACK">Estiba / monte</option></select></label>
    <label>Instruções adicionais<input name="notes" maxLength={240} defaultValue={machine.currentOrder?machine.notes??"":""} placeholder="Ex.: 8 embalagens por camada" disabled={!enabled||busy}/></label>
    <button className="btn primary" disabled={!enabled||busy}>{busy?"A guardar…":"Publicar ordem no ecrã"}</button>{message&&<p role="status">{message}</p>}
  </form>;
}
export function DisplayAdmin({machines,lots,devices,cycleActive}:{machines:Machine[];lots:Lot[];devices:Device[];cycleActive:boolean}) {
  const router=useRouter();const notify=useFeedback();const [code,setCode]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useFeedbackState("error");
  return <div className="form-stack"><section className="panel form-stack"><h2>Ligar uma TV ou monitor</h2>
    <p>Abra <a href="/display" target="_blank" rel="noreferrer">/display</a> no navegador da TV ou de um computador ligado por HDMI. Use a mesma ligação da aplicação e introduza o código abaixo. O ecrã atualiza automaticamente; não precisa de uma sessão de administrador.</p>
    <form className="form-stack" onSubmit={async event=>{event.preventDefault();const fd=new FormData(event.currentTarget);setBusy(true);setError("");setCode("");try{const result=await createDisplayDevice(fd);setCode(result.code);notify("success","Código de ligação do ecrã criado.");router.refresh();}catch(e){setError(e instanceof Error?e.message:"Não foi possível gerar código.");}finally{setBusy(false);}}}>
      <label>Nome do ecrã<input name="name" placeholder="TV da produção" maxLength={80} required/></label><button className="btn primary" disabled={busy}>Gerar código de ligação</button>
    </form>{code&&<p className="alert success" role="status">Código: <strong>{code}</strong> · válido durante 10 minutos, para uma única ligação.</p>}
    <p className="muted">Ligação válida por 90 dias. Pode revogar o acesso a qualquer momento. A TV deve ter acesso à rede da aplicação; em produção, utilize HTTPS.</p>
    {devices.map(device=><div className="display-device" key={device.id}><span><strong>{device.name}</strong> · {device.paired?`Ligado até ${device.expiresAt?.slice(0,10)}`:`Por ligar · código válido até ${new Date(device.pairingExpiresAt).toLocaleTimeString("pt-PT")}`}</span><button className="btn secondary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const fd=new FormData();fd.set("id",device.id);await revokeDisplayDevice(fd);notify("success","Acesso do ecrã revogado.");router.refresh();}catch{setError("Não foi possível revogar o ecrã.");}finally{setBusy(false);}}}>Revogar acesso</button></div>)}
    {error&&<p role="alert" className="alert error">{error}</p>}
  </section><section><h2>Ordens de paletização por máquina</h2><p>As ordens são válidas para o ciclo semanal atual. O código interno previsto acompanha a mudança de turno; depois de guardar a produção, o ecrã mostra o lote registado. Confirme a ordem se mudar de produto ou de lote comercial.</p>
    {!cycleActive&&<p className="alert error">Conclua o arranque semanal para publicar ordens.</p>}
    <div className="admin-grid">{machines.map(machine=><OrderForm key={`${machine.id}-${machine.currentOrder}`} machine={machine} lots={lots} enabled={cycleActive}/>)}</div>
  </section></div>;
}
