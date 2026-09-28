"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFeedback, useFeedbackState } from "@/components/FeedbackProvider";
import { editProducedLot, saveProductLotConfig } from "@/app/actions/lots";
const letters=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
export function ProductLotSettings({productId,prefix,version,examples,existing}:{productId:number;prefix:string;version?:number;examples?:{code:string;suffix:string}[];existing?:{code:string;count:number}}){
  const [first,setFirst]=useState(""),[second,setSecond]=useState("");
  const [machine,setMachine]=useState(""),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useFeedbackState("error");
  const inFlight=useRef(false),router=useRouter(),notify=useFeedback();
  const suffix=existing?.code.slice(2)??examples?.find(e=>e.code===machine)?.suffix;
  return <form className="form-stack" noValidate aria-busy={busy} onSubmit={async event=>{
    event.preventDefault();if(inFlight.current)return;
    const form=event.currentTarget;
    const missing=!first?{name:"majorLetter",message:"Selecione a primeira letra."}:!second?{name:"minorLetter",message:"Selecione a segunda letra."}:!reason.trim()?{name:"reason",message:"Explique a alteração e o motivo antes de guardar."}:null;
    if(missing){setError(missing.message);(form.elements.namedItem(missing.name) as HTMLElement|null)?.focus();return;}
    const data=new FormData(form);inFlight.current=true;setBusy(true);setError("");
    try{
      const result=await (existing?editProducedLot:saveProductLotConfig)(data);
      if(!result.ok){setError(result.message);return;}
      notify("success",result.message??(existing?"Lote corrigido. O código anterior mantém-se pesquisável na rastreabilidade.":`Letras ${first}${second} guardadas para os novos registos deste produto.`));
      setFirst("");setSecond("");setMachine("");setReason("");router.refresh();
    }catch{setError("Não foi possível confirmar a gravação. Atualize a página para verificar as letras atuais antes de repetir.");}
    finally{inFlight.current=false;setBusy(false);}
  }}><fieldset className="feedback-form-fields" disabled={busy}>
    <input type="hidden" name="productId" value={productId}/>
    {existing?<><input type="hidden" name="expectedCode" value={existing.code}/><input type="hidden" name="expectedCount" value={existing.count}/></>:<input type="hidden" name="expectedVersion" value={version??0}/>}
    <p className="muted">{existing?`Lote atual: ${existing.code}`:`Letras atuais: ${prefix}`} · Escolha as duas letras pretendidas. Para alterar apenas uma, selecione a letra atual no outro campo.</p>
    <div className="two-col"><label>Primeira letra<select name="majorLetter" value={first} required onChange={e=>setFirst(e.target.value)}><option value="">Selecione a primeira letra</option>{letters.map(l=><option key={l}>{l}</option>)}</select></label><label>Segunda letra<select name="minorLetter" value={second} required onChange={e=>setSecond(e.target.value)}><option value="">Selecione a segunda letra</option>{letters.map(l=><option key={l}>{l}</option>)}</select></label></div>
    {!existing&&Boolean(examples?.length)&&<label>Pré-visualizar na máquina (opcional)<select value={machine} onChange={e=>setMachine(e.target.value)}><option value="">Selecione a máquina para ver o exemplo</option>{examples!.map(e=><option key={e.code} value={e.code}>Máquina {e.code}</option>)}</select></label>}
    <div className="lot-code-preview"><span>{existing?"Código após a correção":"Exemplo no turno atual"}</span>{first&&second?<strong><mark>{first}{second}</mark>{suffix??" · restante calculado na produção"}</strong>:<strong>Selecione as duas letras para pré-visualizar.</strong>}<small>As duas letras são escolhidas por si. Turno, dia, semana, ano e máquina são calculados pela app.</small></div>
    {existing?<p className="muted">Corrige este lote em {existing.count} registo(s) do mesmo produto, incluindo a referência no stock e nas saídas. O código anterior fica no histórico. As letras dos novos registos não são alteradas.</p>:<p className="muted">A escolha aplica-se a novos registos deste produto em qualquer máquina. Lotes e rascunhos já guardados mantêm o seu código.</p>}
    <label>Alteração e motivo<textarea name="reason" value={reason} onChange={e=>setReason(e.target.value)} required maxLength={2000} placeholder="Explique o que mudou e o motivo para estas letras."/></label>
    <button type="submit" className="btn primary" disabled={busy}>{busy?"A guardar…":existing?"Guardar correção deste lote":"Guardar letras para novos registos"}</button>
    {error&&<p className="alert error" role="alert">{error}</p>}
  </fieldset></form>;
}
