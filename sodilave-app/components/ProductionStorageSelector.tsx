"use client";
import { productionUnitLabel as unitLabel } from "@/lib/production-unit";

import { useMemo, useState } from "react";
import type { StorageLocationInfo, StorageZoneType } from "@/lib/stock-map";



export function ProductionStorageSelector({
  locations,
  quantityProduced,
  productionUnit,
  allowUnlocated = false,
}: {
  locations: StorageLocationInfo[];
  quantityProduced: string;
  productionUnit: string;
  allowUnlocated?: boolean;
}) {
  const [zoneType, setZoneType] = useState<StorageZoneType>("STACK");
  const [warehouseCode, setWarehouseCode] = useState<string>(locations[0]?.warehouseCode??"W1");
  const [allocations, setAllocations] = useState<Record<number, number>>({});
  const [unlocated, setUnlocated] = useState(false);

  const quantity = Math.max(0, Math.trunc(Number(quantityProduced || 0)));
  const visible = useMemo(
    () => locations.filter((location) => location.warehouseCode === warehouseCode && location.zoneType === zoneType),
    [locations, warehouseCode, zoneType],
  );
  const selected = useMemo(
    () => locations.filter((location) => allocations[location.id] !== undefined),
    [locations, allocations],
  );
  const allocatedTotal = selected.reduce((sum, location) => sum + (allocations[location.id] ?? 0), 0);

  const selectLocation = (locationId: number) => {
    if (unlocated) return;
    setAllocations((current) => {
      if (current[locationId] !== undefined) {
        const next = { ...current };
        delete next[locationId];
        return next;
      }
      const activeIds = Object.keys(current);
      return { ...current, [locationId]: activeIds.length === 0 && quantity > 0 ? quantity : 0 };
    });
  };

  const changeZone = (value: StorageZoneType) => {
    if (value === zoneType) return;
    setZoneType(value);
    setAllocations({});
  };

  const changeAllocation = (locationId: number, value: number) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), quantity || Math.trunc(value))) : 0;
    setAllocations((current) => ({ ...current, [locationId]: safe }));
  };

  return <section className="subpanel form-stack production-storage-selector">
    <div>
      <h3>Destino físico da produção *</h3>
      <p className="muted small">Indique onde ficaram guardados os {unitLabel(productionUnit)} desta produção. Pode dividir o mesmo lote por várias posições.</p>
    </div>

    {allowUnlocated && <label className="check historical-unlocated-check">
      <input
        type="checkbox"
        name="storageUnlocated"
        checked={unlocated}
        onChange={(e) => {
          setUnlocated(e.target.checked);
          if (e.target.checked) setAllocations({});
        }}
      />
      Registo histórico sem localização atual conhecida / localização a regularizar
    </label>}

    {!unlocated && <>
      <div className="two-col">
        <label>Forma de armazenamento
          <select value={zoneType} onChange={(e) => changeZone(e.target.value as StorageZoneType)}>
            <option value="STACK">Estibas / montes</option>
            <option value="PALLET">Em paletes</option>
          </select>
        </label>
        <label>Armazém a visualizar
          <select value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)}>
            {[...new Map(locations.map(l=>[l.warehouseCode,l.warehouseName])).entries()].map(([code,name])=><option value={code} key={code}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="production-storage-map" style={{gridTemplateColumns:"repeat(7,minmax(0,1fr))"}}>
        {visible.map((location) => {
          const active = allocations[location.id] !== undefined;
          return <button
            type="button"
            key={location.id}
            className={`storage-map-cell selector-cell${active ? " selected" : ""}`}
            onClick={() => selectLocation(location.id)}
            aria-pressed={active}
          >
            <strong>{location.code}</strong>
            <small>{active ? `${allocations[location.id] ?? 0} ${unitLabel(productionUnit, allocations[location.id] ?? 0)}` : "Selecionar"}</small>
          </button>;
        })}
      </div>

      {selected.length > 0 && <div className="storage-selected-list">
        {selected.map((location) => <div className="storage-selected-row" key={location.id}>
          <div>
            <strong>{location.warehouseName} · {location.zoneType === "STACK" ? "Estiba" : "Paletes"} · {location.code}</strong>
          </div>
          <label>Quantidade ({unitLabel(productionUnit)})
            <input
              name={`storage_location_${location.id}`}
              type="number"
              min="0"
              step="1"
              value={allocations[location.id] ?? 0}
              onChange={(e) => changeAllocation(location.id, Number(e.target.value || 0))}
            />
          </label>
          <button type="button" className="icon-btn danger" onClick={() => selectLocation(location.id)} aria-label="Remover localização">×</button>
        </div>)}
      </div>}

      <div className={`storage-allocation-summary ${quantity > 0 && allocatedTotal === quantity ? "complete" : ""}`}>
        <span>Produção: <strong>{quantity.toLocaleString("pt-PT")} {unitLabel(productionUnit, quantity)}</strong></span>
        <span>Localizado: <strong>{allocatedTotal.toLocaleString("pt-PT")} {unitLabel(productionUnit, allocatedTotal)}</strong></span>
        <span>Por localizar: <strong>{Math.abs(quantity - allocatedTotal).toLocaleString("pt-PT")} {unitLabel(productionUnit, Math.abs(quantity - allocatedTotal))}</strong></span>
      </div>
    </>}
  </section>;
}
