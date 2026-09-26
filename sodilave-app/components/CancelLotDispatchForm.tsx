"use client";
import { useFeedback, useFeedbackState } from "@/components/FeedbackProvider";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelLotDispatch } from "@/app/actions/lot-dispatch";

export function CancelLotDispatchForm({dispatchId}:{dispatchId:number}) {
  const router=useRouter();const notify=useFeedback();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useFeedbackState("error");
  const [cancelled,setCancelled]=useState(false);
  if(cancelled) return <p>Saída anulada. Stock reposto nas posições de origem.</p>;
  return <details><summary>Anular / corrigir</summary>
    <p className="small">Anule para repor o stock nas posições de origem e depois registe a saída com os dados corretos.</p>
    <form action={async fd=>{
      if(!confirm("Anular esta saída e repor o stock nas posições de origem?"))return;
      setBusy(true);setError("");
      try {await cancelLotDispatch(fd);setCancelled(true);notify("success","Saída anulada e stock reposto com sucesso.");router.refresh();}
      catch(e){setError(e instanceof Error?e.message:"Não foi possível anular a saída.");}
      finally{setBusy(false);}
    }}>
      <input type="hidden" name="dispatchId" value={dispatchId}/>
      <label>Motivo da anulação<input name="reason" required maxLength={500}/></label>
      {error&&<p className="alert error" role="alert">{error}</p>}
      <button className="btn secondary" disabled={busy}>{busy?"A anular…":"Anular saída"}</button>
    </form>
  </details>;
}
