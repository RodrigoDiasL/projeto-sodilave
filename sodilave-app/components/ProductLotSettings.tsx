"use client";
import { useState } from "react";
import { FeedbackForm } from "@/components/FeedbackForm";
import { editProducedLot, saveProductLotConfig } from "@/app/actions/lots";
const letters=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
export function ProductLotSettings({productId,prefix,version,examples,existing}:{productId:number;prefix:string;version?:number;examples?:{code:string;suffix:string}[];existing?:{code:string;count:number}}){
  const [first,setFirst]=useState(prefix[0]??"A"),[second,setSecond]=useState(prefix[1]??"A");
  const [machine,setMachine]=useState(examples?.[0]?.code??"");
  const suffix=existing?.code.slice(2)??examples?.find(e=>e.code===machine)?.suffix;
  return <FeedbackForm action={existing?editProducedLot:saveProductLotConfig} className="form-stack" successMessage={existing?"Lote corrigido. O código anterior mantém-se pesquisável na rastreabilidade.":"Letras guardadas para os novos registos deste produto."}>
    <input type="hidden" name="productId" value={productId}/>
    {existing?<><input type="hidden" name="expectedCode" value={existing.code}/><input type="hidden" name="expectedCount" value={existing.count}/></>:<input type="hidden" name="expectedVersion" value={version??0}/>}
    <div className="two-col"><label>Primeira letra<select name="majorLetter" value={first} onChange={e=>setFirst(e.target.value)}>{letters.map(l=><option key={l}>{l}</option>)}</select></label><label>Segunda letra<select name="minorLetter" value={second} onChange={e=>setSecond(e.target.value)}>{letters.map(l=><option key={l}>{l}</option>)}</select></label></div>
    {!existing&&Boolean(examples?.length)&&<label>Pré-visualizar na máquina<select value={machine} onChange={e=>setMachine(e.target.value)}>{examples!.map(e=><option key={e.code} value={e.code}>Máquina {e.code}</option>)}</select></label>}
    <div className="lot-code-preview"><span>{existing?"Código após a correção":"Exemplo no turno atual"}</span><strong><mark>{first}{second}</mark>{suffix??" · restante calculado na produção"}</strong><small>As duas letras são escolhidas por si. Turno, dia, semana, ano e máquina são calculados pela app.</small></div>
    {existing?<p className="muted">Corrige este lote em {existing.count} registo(s) do mesmo produto, incluindo a referência no stock e nas saídas. O código anterior fica no histórico. As letras dos novos registos não são alteradas.</p>:<p className="muted">Pode mudar a primeira letra, a segunda ou ambas. A escolha aplica-se a novos registos deste produto em qualquer máquina. Lotes e rascunhos já guardados mantêm o seu código.</p>}
    <label>Alteração e motivo<textarea name="reason" required maxLength={2000} placeholder="Explique o que mudou e o motivo para estas letras."/></label>
    <button className="btn primary" disabled={first+second===prefix}>{existing?"Guardar correção deste lote":"Guardar letras para novos registos"}</button>
  </FeedbackForm>;
}
