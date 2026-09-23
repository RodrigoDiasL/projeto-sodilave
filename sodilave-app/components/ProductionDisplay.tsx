"use client";
import { useEffect, useRef, useState } from "react";
import type { DisplayData } from "@/lib/production-display";

export function ProductionDisplay() {
  const [data,setData]=useState<DisplayData|null>(null);
  const [pairing,setPairing]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [online,setOnline]=useState(false);
  const [clock,setClock]=useState(0);
  const received=useRef(0);
  const [generation,setGeneration]=useState(0);
  useEffect(()=>{
    let disposed=false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController|null=null;
    const tick=setInterval(()=>setClock(Date.now()),1000);
    async function refresh() {
      active=new AbortController();
      const timeout=setTimeout(()=>active?.abort(),8000);
      try {
        const response=await fetch("/api/production-display",{cache:"no-store",signal:active.signal});
        if (disposed) return;
        if (response.status===401) { setPairing(true);setData(null);setOnline(false);return; }
        if (!response.ok) throw new Error("offline");
        const next: DisplayData=await response.json();
        if (disposed) return;
        received.current=Date.now();setClock(Date.now());setData(next);setPairing(false);setOnline(true);setError("");
      } catch { if(!disposed) setOnline(false); }
      finally { clearTimeout(timeout); if(!disposed) timer=setTimeout(refresh,10000); }
    }
    void refresh();
    return ()=>{disposed=true;clearInterval(tick);clearTimeout(timer);active?.abort();};
  },[generation]);
  // Use elapsed local time, not the TV's wall clock, to respect the server's shift boundary.
  const age=clock-received.current;
  const valid=data && online && age<30000 && age<new Date(data.validUntil).getTime()-new Date(data.generatedAt).getTime();
  return <main className="production-display">
    <header className="display-header"><div><span>SODILAVE · PRODUÇÃO</span><h1>Lotes e paletização</h1></div><div>
      {data && <strong>{data.shift}</strong>}
      <p role="status">{pairing ? "Emparelhamento necessário" : valid ? "● Em direto · atualização a cada 10 s" : "● A aguardar ligação — confirmar instruções"}</p>
      <button className="display-fullscreen" onClick={()=>{ if(!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(()=>setError("Use F11 para abrir em ecrã completo.")); else void document.exitFullscreen?.(); }}>Ecrã completo</button>
    </div></header>
    {pairing ? <form className="display-pair" onSubmit={async event=>{
      event.preventDefault();const fd=new FormData(event.currentTarget);setBusy(true);setError("");
      try {
        const response=await fetch("/api/production-display/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:String(fd.get("code")??"").trim()}),signal:AbortSignal.timeout(10000)});
        const result=await response.json();if(!response.ok)throw new Error(result.error);
        setPairing(false);setGeneration(value=>value+1);
      } catch(e) {setError(e instanceof Error ? e.message : "Não foi possível emparelhar.");}
      finally {setBusy(false);}
    }}><h2>Ligar este ecrã à aplicação</h2><p>Peça ao administrador um código em Administração → Ecrã de produção.</p>
      <label>Código de 8 algarismos<input name="code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} autoComplete="off" required/></label>
      <button disabled={busy}>{busy?"A ligar…":"Ligar ecrã"}</button><p>Este ecrã permite apenas consultar os lotes e as instruções.</p>
    </form> : !valid ? <div className="display-notice"><h2>Informação temporariamente indisponível</h2><p>A ligação é retomada automaticamente. Confirme o lote e a paletização com o responsável antes de continuar.</p></div> : !data.cycleActive || !data.machines.length ? <div className="display-notice"><h2>{data.cycleActive?"Sem máquinas em funcionamento":"Sem ciclo semanal ativo"}</h2></div> : <section className="display-grid">
      {data.machines.map(machine=><article key={machine.id} className={`display-machine ${machine.code==="7"?"display-machine-last":""}`}>
        <div className="display-machine-heading"><h2>Máquina {machine.code}</h2><span>Em funcionamento</span></div>
        <p className="display-product">{machine.product??"Produto por confirmar"}</p>
        <small>{machine.lotState==="PLANNED"?"Lote previsto · aguarda registo do turno":machine.lotState==="REGISTERED"?"Lote registado neste turno":"Sem lote definido"}</small>
        <strong className="display-lot">{machine.lot??"Confirmar com o responsável"}</strong>
        <div className={`display-destination ${machine.destination?.toLowerCase()??"missing"}`}>{machine.destination==="PALLET"?"PARA PALETES":machine.destination==="STACK"?"PARA ESTIBA / MONTE":"DESTINO POR CONFIRMAR"}</div>
        {machine.notes&&<p className="display-notes">{machine.notes}</p>}{machine.warning&&<p className="display-warning">{machine.warning}</p>}
      </article>)}
    </section>}
    {error&&<p className="display-warning" role="alert">{error}</p>}
  </main>;
}
