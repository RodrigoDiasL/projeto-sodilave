"use client";

import { useMemo, useState, type ReactNode } from "react";
import { addUnlocatedStock, adjustStockMap, transferStockMap, relocateStoragePosition } from "@/app/actions/stock-map";
import { useRouter } from "next/navigation";
import type { StorageMapLocation, StorageLocationInfo, UnlocatedFinishedLot } from "@/lib/stock-map";

// Keep expected validation errors on the form instead of the global error screen.
function StockForm({ action, children }: { action:(fd:FormData)=>Promise<void>; children:ReactNode }) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  return <form className="form-stack compact-admin-form" onSubmit={async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);setBusy(true);setMessage("");
    try {await action(fd);setMessage("Alteração guardada.");router.refresh();}
    catch(e){setMessage(e instanceof Error?e.message:"Não foi possível guardar. Tente novamente.");}
    finally{setBusy(false);}
  }}><fieldset disabled={busy} className="form-stack stock-form-fields">{children}</fieldset>{message&&<p role="status">{message}</p>}</form>;
}

const packageLabel = (unit: string, quantity: number) =>
  unit === "PALLET" ? (quantity === 1 ? "palete" : "paletes") : (quantity === 1 ? "saco" : "sacos");

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
    <div className="stock-map-grid">
      {locations.map((location) => <button
        type="button"
        key={location.id}
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
    </div>
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
  const selected = locations.find((location) => location.id === selectedId) ?? null;

  const groups = useMemo(() => ({
    w1Stack: locations.filter((l) => l.warehouseCode === "W1" && l.zoneType === "STACK"),
    w1Pallet: locations.filter((l) => l.warehouseCode === "W1" && l.zoneType === "PALLET"),
    w2Stack: locations.filter((l) => l.warehouseCode === "W2" && l.zoneType === "STACK"),
    w2Pallet: locations.filter((l) => l.warehouseCode === "W2" && l.zoneType === "PALLET"),
  }), [locations]);

  return <div className="stock-map-layout">
    <div className="stock-map-main">
      <MapGrid title="Armazém 1" subtitle="Estibas / montes · 7 colunas × 10 linhas" locations={groups.w1Stack} selectedId={selectedId} onSelect={setSelectedId}/>
      <MapGrid title="Armazém 1 · Paletes" subtitle="Zona adicional de paletes · 7 colunas × 5 linhas" locations={groups.w1Pallet} selectedId={selectedId} onSelect={setSelectedId}/>
      <MapGrid title="Armazém 2" subtitle="Estibas / montes · 7 colunas × 15 linhas" locations={groups.w2Stack} selectedId={selectedId} onSelect={setSelectedId}/>
      <MapGrid title="Armazém 2 · Paletes" subtitle="Zona adicional de paletes · 7 colunas × 5 linhas" locations={groups.w2Pallet} selectedId={selectedId} onSelect={setSelectedId}/>
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
  </div>;
}
