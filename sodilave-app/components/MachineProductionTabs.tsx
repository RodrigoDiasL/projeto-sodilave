"use client";
import {useState,type ReactNode,useRef} from "react";
export function MachineProductionTabs({items,initialMachineId}:{items:{id:number;code:string;name:string;status:string;content:ReactNode}[];initialMachineId?:number}){
  const [selected,setSelected]=useState(initialMachineId??items[0]?.id);
  const active=items.some(m=>m.id===selected)?selected:items[0]?.id;
  const nav=useRef<HTMLDivElement>(null);
  if(!items.length)return <div className="notice">Não há máquinas com atividade registada neste turno. Confirme a data e o turno escolhidos. Para folhas anteriores à aplicação, o administrador pode usar Importar histórico.</div>;
  return <div className="machine-tabs"><div ref={nav} className="machine-tabs-nav" role="tablist" aria-label="Máquinas de produção">{items.map((m,index)=><button key={m.id} id={`machine-tab-${m.id}`} role="tab" aria-selected={active===m.id} aria-controls={`machine-panel-${m.id}`} tabIndex={active===m.id?0:-1} type="button" onClick={()=>setSelected(m.id)} onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowRight"?1:-1)+items.length)%items.length;setSelected(items[next].id);(nav.current?.children[next] as HTMLButtonElement)?.focus();}}><strong>Máquina {m.code}</strong><span>{m.status}</span></button>)}</div>
    {items.map(m=><div key={m.id} role="tabpanel" id={`machine-panel-${m.id}`} aria-labelledby={`machine-tab-${m.id}`} hidden={active!==m.id}>{m.content}</div>)}
  </div>;
}
