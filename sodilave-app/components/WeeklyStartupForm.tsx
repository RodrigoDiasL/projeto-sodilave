"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWeeklyStartup } from "@/app/actions/startup";

type Machine={id:number;code:string;name:string};
const keys=["acrylics","plasticTrays","lighting","extruderTemperatures","lubrication","mouldCleaning","beltsTraysTables","waterFilters"];
const generalKeys=["productionWindows","storageWindows","dispatchWindows","forkliftIntegrity","emergencyLighting"];
const options=<><option value="">Selecione</option><option value="CONFORMING">Conforme</option><option value="NON_CONFORMING">Não conforme</option><option value="NOT_APPLICABLE">Não aplicável</option></>;

export function WeeklyStartupForm({machines,initial}:{machines:Machine[];initial?:any}){
 const [selected,setSelected]=useState<number[]>(initial?.machines?.map((m:any)=>m.machineId)??[]);
 const [values,setValues]=useState<Record<string,string>>(()=>{const v:Record<string,string>={};for(const m of initial?.machines??[])for(const k of keys)v[`m${m.machineId}_${k}`]=m[k]??"";return v});
 const [generalValues,setGeneralValues]=useState<Record<string,string>>(()=>Object.fromEntries(generalKeys.map(k=>[k,initial?.[k]??""])));
 // Old migrations copied the legacy flag to both pumps. Require a real choice
 // for such drafts instead of guessing which pump was operating.
 const [coolingPump,setCoolingPump]=useState(initial?.coolingPump1 && !initial?.coolingPump2 ? "1" : initial?.coolingPump2 && !initial?.coolingPump1 ? "2" : "");
 const router=useRouter();
 const [recordId,setRecordId]=useState(initial?.id??"");
 const [busy,setBusy]=useState(false);
 const [finished,setFinished]=useState(false);
 const [msg,setMsg]=useState("");const [error,setError]=useState("");
 const setAll=(id:number)=>setValues(v=>({...v,...Object.fromEntries(keys.map(k=>[`m${id}_${k}`,"CONFORMING"]))}));
 const setAllGeneral=()=>setGeneralValues(Object.fromEntries(generalKeys.map(k=>[k,"CONFORMING"])));
 const toggleMachine=(id:number)=>setSelected(current=>current.includes(id)?current.filter(machineId=>machineId!==id):[...current,id]);
 const action=async(fd:FormData)=>{setMsg("");setError("");if(fd.get("intent")==="finalize"&&!confirm("Finalizar o arranque semanal?"))return;setBusy(true);try{const r=await saveWeeklyStartup(fd);setRecordId(r.id);setFinished(r.finalized);router.refresh();setMsg(r.finalized?"Arranque semanal finalizado.":"Rascunho do arranque gravado.");}catch(e){setError(e instanceof Error?e.message:"Não foi possível guardar.")}finally{setBusy(false)}};
 return <form action={action} className="panel form-stack">
 <input type="hidden" name="startupId" value={recordId}/>
 {selected.map(id=><input key={id} type="hidden" name="machineIds" value={id}/>) }
 <section className="subpanel"><h2>Máquinas a arrancar</h2><div className="machine-grid">{machines.map(m=>{const active=selected.includes(m.id);return <button type="button" className={`machine-option machine-select-button${active?" selected":""}`} style={active?{background:"#f0fff5",border:"2px solid #22a447",color:"#15803d",boxShadow:"0 0 0 3px rgba(34,164,71,.18)"}:undefined} key={m.id} aria-pressed={active} onClick={()=>toggleMachine(m.id)}><img src={['5','6'].includes(m.code)?'/maq-tampas.png':'/maq-garrafoes.png'} alt=""/><strong>{m.code}</strong></button>})}</div></section>
 <section className="subpanel"><h2>Equipamentos de apoio</h2><div className="two-col">{[["chillerSmall","Refrigerador pequeno"],["chillerLarge","Refrigerador grande"],["compressor","Compressor"],["airDryers","Secadores de ar"],["airDemolecularizer","Desmoleculizador de ar"]].map(([k,l])=><label className="check" key={k}><input type="checkbox" name={k} defaultChecked={initial?.[k]}/>{l}</label>)}</div></section>
 <fieldset className="subpanel"><legend>Bomba de refrigeração em funcionamento</legend><p className="muted small">Selecione uma bomba. A outra fica de reserva.</p><div className="two-col">{["1","2"].map(value=><label className="check" key={value}><input type="radio" name="coolingPump" value={value} checked={coolingPump===value} onChange={()=>setCoolingPump(value)} required/>Bomba de refrigeração {value}</label>)}</div></fieldset>
 <section className="subpanel"><div className="section-heading"><h2>Verificações gerais</h2><button type="button" className="btn secondary" onClick={setAllGeneral}>Conforme em tudo</button></div><div className="two-col">{[["productionWindows","Acrílicos e janelas da produção"],["storageWindows","Janelas do armazenamento"],["dispatchWindows","Janelas da expedição"],["forkliftIntegrity","Integridade do empilhador"],["emergencyLighting","Iluminárias de emergência"]].map(([k,l])=><label key={k}>{l}<select name={k} value={generalValues[k]??""} onChange={e=>setGeneralValues(v=>({...v,[k]:e.target.value}))}>{options}</select></label>)}</div></section>
 {selected.map(id=>{const m=machines.find(x=>x.id===id)!;const labels=["Acrílicos envolventes","Integridade dos tabuleiros de plástico","Integridade da iluminária","Temperaturas da extrusora (±2 °C do setpoint)","Lubrificação conforme manual","Limpeza de molde e contra-molde","Limpeza de tapetes, aparadeiras e mesas","Limpeza de filtros de água"];return <section className="subpanel" key={id}><div className="section-heading"><h2>Máquina {m.code}</h2><button type="button" className="btn secondary" onClick={()=>setAll(id)}>Conforme em tudo</button></div><div className="two-col">{keys.map((k,i)=><label key={k}>{labels[i]}<select name={`m${id}_${k}`} value={values[`m${id}_${k}`]??""} onChange={e=>setValues(v=>({...v,[`m${id}_${k}`]:e.target.value}))}>{options}</select></label>)}</div></section>})}
 <label>Observações<textarea name="observations" defaultValue={initial?.observations??""}/></label>{error&&<div className="alert error">{error}</div>}{msg&&<div className="alert success">{msg}</div>}<div className="button-row"><button disabled={busy||finished} className="btn secondary" name="intent" value="draft" formNoValidate>Gravar rascunho</button><button disabled={busy||finished} className="btn primary" name="intent" value="finalize">Finalizar arranque</button></div></form>;
}
