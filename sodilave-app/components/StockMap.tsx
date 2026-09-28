"use client";
import { productionUnitLabel as packageLabel } from "@/lib/production-unit";
import { useFeedback } from "@/components/FeedbackProvider";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { submitAddUnlocatedStock as addUnlocatedStock, submitAdjustStockMap as adjustStockMap, submitTransferStockMap as transferStockMap, submitRelocateStoragePosition as relocateStoragePosition } from "@/app/actions/stock-map";
import { useRouter } from "next/navigation";
import type { StorageMapLocation, StorageLocationInfo, UnlocatedFinishedLot } from "@/lib/stock-map";

// Keep expected validation errors on the form instead of the global error screen.
function StockForm({ action, children }: { action:(fd:FormData)=>Promise<{ok:true}|{ok:false;message:string}>; children:ReactNode }) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const notify=useFeedback();
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(""),3000);return()=>clearTimeout(timer);},[message]);
  return <form className="form-stack compact-admin-form" onSubmit={async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);setBusy(true);setMessage("");
    try {const result=await action(fd);if(!result.ok)throw new Error(result.message);setMessage("Alteração guardada.");notify("success","Alteração guardada.");router.refresh();}
    catch(e){const message=e instanceof Error?e.message:"Não foi possível guardar. Tente novamente.";setMessage(message);notify("error",message);}
    finally{setBusy(false);}
  }}><fieldset disabled={busy} className="form-stack stock-form-fields">{children}</fieldset>{message&&<p role="status">{message}</p>}</form>;
}



function MapGrid({
  title,
  subtitle,
  locations,
  selectedId,
  onSelect,
}: {
  title: string;
  subtitle: string;
  locations: StorageMapLocation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return <section className="panel stock-map-zone">
    <div className="section-heading">
      <div><h2>{title}</h2><p className="muted small">{subtitle}</p></div>
    </div>
    <div className="stock-map-scroll" tabIndex={0} aria-label={`Mapa de ${title}`}><div className="stock-map-grid" style={{gridTemplateColumns:`repeat(${Math.max(1,...locations.map(l=>l.columnNumber))},minmax(95px,1fr))`}}>
      {locations.map((location) => <button
        type="button"
        key={location.id}
        style={{gridColumn:location.columnNumber,gridRow:location.rowNumber}}
        onClick={() => onSelect(location.id)}
        className={`stock-map-cell ${location.lotCount ? "occupied" : "empty"} ${selectedId === location.id ? "selected" : ""}`}
      >
        <span className="stock-map-cell-code">{location.code}</span>
        {location.lotCount === 0
          ? <small>Livre</small>
          : <>
            <small>{location.totalPackages} emb. · {location.lotCount} lote(s)</small>
            <div className="stock-map-cell-lots">
              {location.lots.slice(0, 3).map((lot) => <span key={lot.productionId}>{lot.lotCode} · {lot.quantityPackages}</span>)}
              {location.lots.length > 3 && <span>+ {location.lots.length - 3} lote(s)</span>}
            </div>
          </>}
      </button>)}
    </div></div>
  </section>;
}

export function StockMap({
  locations,
  allLocations,
  unlocated,
  isAdmin,
}: {
  locations: StorageMapLocation[];
  allLocations: StorageLocationInfo[];
  unlocated: UnlocatedFinishedLot[];
  isAdmin: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const warehouses = useMemo(()=>Array.from(new Map(locations.map(l=>[l.warehouseCode,l.warehouseName])).entries()),[locations]);
  const [warehouseCode,setWarehouseCode]=useState(locations[0]?.warehouseCode??"W1");
  const activeWarehouse=warehouses.some(([code])=>code===warehouseCode)?warehouseCode:warehouses[0]?.[0];
  const selected = locations.find((location) => location.id === selectedId) ?? null;

  const groups = useMemo(() => {
    const result=new Map<string,{title:string;zoneType:string;locations:StorageMapLocation[]}>();
    for(const l of locations){const key=`${l.warehouseCode}:${l.zoneType}`;if(!result.has(key))result.set(key,{title:l.warehouseName,zoneType:l.zoneType,locations:[]});result.get(key)!.locations.push(l);}
    return [...result.values()];
  }, [locations]);

  return <><nav className="stock-warehouse-tabs" aria-label="Selecionar armazém">{warehouses.map(([code,name])=><button type="button" key={code} aria-pressed={activeWarehouse===code} className={`btn ${activeWarehouse===code?"primary":"secondary"}`} onClick={()=>{setWarehouseCode(code);setSelectedId(null);}}>{name}</button>)}</nav><div className="stock-map-layout">
    <div className="stock-map-main">
      {groups.filter(group=>group.locations[0].warehouseCode===activeWarehouse).map(group=><MapGrid key={`${group.locations[0].warehouseCode}:${group.zoneType}`} title={group.title+(group.zoneType==="PALLET"?" · Paletes":"")} subtitle={`${group.zoneType==="PALLET"?"Paletes":"Estibas / montes"} · ${group.locations.length} posições`} locations={group.locations} selectedId={selectedId} onSelect={setSelectedId}/>)}
      {!groups.length&&<p>Não existem posições ativas. O administrador pode adicioná-las em Gerir armazém e stock inicial.</p>}
    </div>

    <aside className="panel stock-map-details">
      {!selected ? <div className="empty-state">Selecione uma posição no mapa para consultar os lotes guardados.</div> : <>
        <div className="stock-location-heading">
          <div>
            <span>{selected.warehouseName}</span>
            <h2>{selected.zoneType === "STACK" ? "Estiba / monte" : "Paletes"} · {selected.code}</h2>
          </div>
          <strong>{selected.totalPackages} embalagem(ns)</strong>
        </div>

        {isAdmin && selected.lots.length>0 && <section className="stock-relocation">
          <h3>Corrigir localização física</h3>
          <p className="small">Move todos os lotes desta posição para uma posição livre, sem alterar as quantidades. Use quando a estiba / monte foi registada no lugar errado.</p>
          <StockForm key={`relocate-${selected.id}-${JSON.stringify(selected.lots.map(l=>[l.productionId,l.quantityPackages]))}`} action={relocateStoragePosition}>
            <input type="hidden" name="fromLocationId" value={selected.id}/>
            <input type="hidden" name="expectedContents" value={JSON.stringify(selected.lots.map(l=>({productionId:l.productionId,quantityPackages:l.quantityPackages})))}/>
            <label>Localização física correta<select name="toLocationId" required defaultValue=""><option value="">Selecione uma posição livre</option>
              {locations.filter(l=>l.id!==selected.id&&l.zoneType===selected.zoneType&&l.lotCount===0).map(l=><option key={l.id} value={l.id}>{l.warehouseName} · {l.code}</option>)}
            </select></label>
            <label>Motivo<input name="reason" maxLength={500} placeholder="Ex.: operador selecionou a posição errada" required/></label>
            <button className="btn primary">Corrigir localização de todos os lotes</button>
          </StockForm>
        </section>}

        {selected.lots.length === 0 ? <p className="empty-state">Esta posição está livre.</p> : <div className="stock-location-lots">
          {selected.lots.map((lot) => <article className="stock-location-lot" key={lot.productionId}>
            <div>
              <strong>{lot.lotCode}</strong>
              <span>{lot.productCode} — {lot.productName}</span>
              <small>{lot.quantityPackages} {packageLabel(lot.productionUnit, lot.quantityPackages)} · {lot.quantityUnits.toLocaleString("pt-PT")} artigos</small>
            </div>

            {isAdmin && <details className="stock-admin-tools">
              <summary>Corrigir / mover</summary>
              <StockForm key={`adjust-${selected.id}-${lot.productionId}-${lot.quantityPackages}`} action={adjustStockMap}>
                <input type="hidden" name="productionId" value={lot.productionId}/>
                <input type="hidden" name="locationId" value={selected.id}/>
                <input type="hidden" name="expectedQuantity" value={lot.quantityPackages}/>
                <label>Quantidade correta nesta posição
                  <input name="newQuantityPackages" type="number" min="0" step="1" defaultValue={lot.quantityPackages} required/>
                </label>
                <label>Motivo da correção
                  <input name="reason" maxLength={500} placeholder="Ex.: contagem física / erro de registo" required/>
                </label>
                <button className="btn secondary">Aplicar correção</button>
              </StockForm>

              <StockForm key={`move-${selected.id}-${lot.productionId}-${lot.quantityPackages}`} action={transferStockMap}>
                <input type="hidden" name="productionId" value={lot.productionId}/>
                <input type="hidden" name="fromLocationId" value={selected.id}/>
                <input type="hidden" name="expectedQuantity" value={lot.quantityPackages}/>
                <label>Mover para
                  <select name="toLocationId" required defaultValue="">
                    <option value="">Selecione a posição de destino</option>
                    {allLocations.filter((location) => location.id !== selected.id).map((location) =>
                      <option key={location.id} value={location.id}>{location.warehouseName} · {location.zoneType === "STACK" ? "Estiba" : "Paletes"} · {location.code}</option>
                    )}
                  </select>
                </label>
                <label>Quantidade a mover
                  <input name="quantityPackages" type="number" min="1" max={lot.quantityPackages} step="1" required/>
                </label>
                <label>Motivo da movimentação
                  <input name="reason" maxLength={500} placeholder="Ex.: reorganização do armazém" required/>
                </label>
                <button className="btn secondary">Mover stock</button>
              </StockForm>
            </details>}
          </article>)}
        </div>}
      </>}

      {isAdmin && <section className="stock-unlocated-section">
        <h2>Stock por localizar</h2>
        <p className="muted small">Produções finalizadas cujo stock atual ainda não está totalmente atribuído ao mapa.</p>
        {unlocated.length === 0 ? <p className="empty-state">Não existem lotes por localizar.</p> : unlocated.map((lot) => <article className="stock-unlocated-lot" key={lot.productionId}>
          <div><strong>{lot.lotCode}</strong><span>{lot.productCode} — {lot.productName}</span><small>Por localizar: {lot.missingPackages} {packageLabel(lot.productionUnit, lot.missingPackages)}</small></div>
          <StockForm key={`locate-${lot.productionId}-${lot.missingPackages}`} action={addUnlocatedStock}>
            <input type="hidden" name="productionId" value={lot.productionId}/>
            <label>Posição
              <select name="locationId" required defaultValue="">
                <option value="">Selecione</option>
                {allLocations.map((location) => <option key={location.id} value={location.id}>{location.warehouseName} · {location.zoneType === "STACK" ? "Estiba" : "Paletes"} · {location.code}</option>)}
              </select>
            </label>
            <label>Quantidade a localizar
              <input name="quantityPackages" type="number" min="1" max={lot.missingPackages} step="1" defaultValue={lot.missingPackages} required/>
            </label>
            <label>Motivo
              <input name="reason" maxLength={500} defaultValue="Regularização da localização física do stock." required/>
            </label>
            <button className="btn secondary">Registar localização</button>
          </StockForm>
        </article>)}
      </section>}
    </aside>
  </div></>;
}
