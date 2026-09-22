"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createLotDispatch } from "@/app/actions/lot-dispatch";
import type { AvailableFinishedLot } from "@/lib/lot-dispatch";

function todayInput() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const packageLabel = (unit: string, quantity: number) =>
  unit === "PALLET" ? (quantity === 1 ? "palete" : "paletes") : (quantity === 1 ? "saco" : "sacos");

export function LotDispatchForm({ lots, employeeName }: { lots: AvailableFinishedLot[]; employeeName: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [productId, setProductId] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const products = useMemo(() => {
    const map = new Map<number, { id: number; code: string; name: string; availableUnits: number }>();
    for (const lot of lots) {
      const existing = map.get(lot.productId);
      if (existing) existing.availableUnits += lot.availableUnits;
      else map.set(lot.productId, {
        id: lot.productId,
        code: lot.productCode,
        name: lot.productName,
        availableUnits: lot.availableUnits,
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [lots]);

  const filteredLots = useMemo(
    () => lots.filter((lot) => String(lot.productId) === productId),
    [lots, productId],
  );

  const target = Number(orderQuantity || 0);
  const totalAvailable = filteredLots.reduce((sum, lot) => sum + lot.availableUnits, 0);
  const selectedUnits = filteredLots.reduce((sum, lot) => {
    const packages = lot.locations.reduce((inner, location) => inner + (allocations[`${lot.productionId}-${location.locationId}`] ?? 0), 0);
    return sum + packages * lot.unitsPerPackage;
  }, 0);
  const difference = target - selectedUnits;

  const setLocationAllocation = (productionId: number, locationId: number, value: number, max: number) => {
    const key = `${productionId}-${locationId}`;
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), max)) : 0;
    setAllocations((current) => ({ ...current, [key]: safe }));
  };

  const fillFifo = () => {
    if (!Number.isInteger(target) || target <= 0) {
      setError("Introduza primeiro a quantidade da encomenda.");
      return;
    }

    let remaining = target;
    const next: Record<string, number> = {};

    for (const lot of filteredLots) {
      if (remaining <= 0) break;
      const unitsPerPackage = lot.unitsPerPackage;
      for (const location of lot.locations) {
        if (remaining < unitsPerPackage) break;
        const packagesNeeded = Math.floor(remaining / unitsPerPackage);
        const packages = Math.min(location.quantityPackages, packagesNeeded);
        if (packages > 0) {
          next[`${lot.productionId}-${location.locationId}`] = packages;
          remaining -= packages * unitsPerPackage;
        }
      }
    }

    setAllocations(next);
    setError(remaining > 0
      ? `Não é possível completar exatamente a encomenda com embalagens completas. Faltam ${remaining} artigo(s).`
      : "");
  };

  const submit = async (fd: FormData) => {
    setMessage("");
    setError("");
    if (!productId) { setError("Selecione o artigo da encomenda."); return; }
    if (!Number.isInteger(target) || target <= 0) { setError("Introduza uma quantidade válida."); return; }
    if (selectedUnits !== target) {
      setError(`As localizações selecionadas totalizam ${selectedUnits} artigo(s), mas a encomenda tem ${target}.`);
      return;
    }

    setSaving(true);
    try {
      const result = await createLotDispatch(fd);
      formRef.current?.reset();
      setProductId("");
      setOrderQuantity("");
      setAllocations({});
      setMessage(`Saída de lotes #${result.id} registada com sucesso.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível registar a saída dos lotes.");
    } finally {
      setSaving(false);
    }
  };

  return <form ref={formRef} action={submit} className="panel form-stack lot-dispatch-form">
    <div className="two-col">
      <label>Cliente *
        <input name="customerName" maxLength={191} required placeholder="Nome do cliente"/>
      </label>
      <label>Encomenda *
        <input name="orderReference" maxLength={191} required placeholder="N.º / referência da encomenda"/>
      </label>
      <label>Fatura *
        <input name="invoiceNumber" maxLength={191} required placeholder="N.º da fatura"/>
      </label>
      <label>Data de saída *
        <input name="dispatchDate" type="date" defaultValue={todayInput()} required/>
      </label>
    </div>

    <section className="subpanel form-stack">
      <div className="two-col">
        <label>Artigo da encomenda *
          <select
            name="productId"
            value={productId}
            required
            onChange={(e) => {
              setProductId(e.target.value);
              setAllocations({});
            }}
          >
            <option value="">Selecione o artigo</option>
            {products.map((product) => <option key={product.id} value={product.id}>
              {product.code} — {product.name} · {product.availableUnits.toLocaleString("pt-PT")} artigos disponíveis
            </option>)}
          </select>
        </label>
        <label>Quantidade da encomenda (artigos) *
          <input
            name="orderedQuantityUnits"
            type="number"
            min="1"
            step="1"
            required
            value={orderQuantity}
            onChange={(e) => setOrderQuantity(e.target.value)}
            placeholder="Ex.: 640"
          />
        </label>
      </div>

      {productId && <div className="lot-dispatch-balance">
        <div><span>Stock localizado</span><strong>{totalAvailable.toLocaleString("pt-PT")} artigos</strong></div>
        <div><span>Selecionado</span><strong>{selectedUnits.toLocaleString("pt-PT")} artigos</strong></div>
        <div className={difference === 0 && target > 0 ? "complete" : difference < 0 ? "excess" : ""}>
          <span>{difference < 0 ? "Excesso" : "Falta selecionar"}</span>
          <strong>{Math.abs(difference).toLocaleString("pt-PT")} artigos</strong>
        </div>
        <button type="button" className="btn secondary" onClick={fillFifo}>Preencher automaticamente por stock mais antigo</button>
      </div>}
    </section>

    {productId && <section className="subpanel">
      <div className="section-heading">
        <div>
          <h2>Lotes e posições disponíveis</h2>
          <p className="muted small">Indique fisicamente de que estibas/paletes vai retirar a encomenda. A aplicação abate exatamente essas posições.</p>
        </div>
      </div>

      {filteredLots.length === 0
        ? <p className="empty-state">Não existem lotes localizados com stock disponível para este artigo.</p>
        : <div className="lot-dispatch-lots">{filteredLots.map((lot) => {
          const selectedPackages = lot.locations.reduce((sum, location) => sum + (allocations[`${lot.productionId}-${location.locationId}`] ?? 0), 0);
          const selectedLotUnits = selectedPackages * lot.unitsPerPackage;
          return <article className={`lot-dispatch-lot ${selectedPackages > 0 ? "selected-stock-lot" : ""}`} key={lot.productionId}>
            <div className="lot-dispatch-lot-heading">
              <div>
                <strong>{lot.lotCode}</strong>
                <span>{lot.productCode} · Produção {new Date(`${lot.productionDate}T12:00:00`).toLocaleDateString("pt-PT")} · Máquina {lot.machineCode}</span>
              </div>
              <div>
                <strong>{lot.availablePackages.toLocaleString("pt-PT")} {packageLabel(lot.productionUnit, lot.availablePackages)}</strong>
                <span>{lot.availableUnits.toLocaleString("pt-PT")} artigos disponíveis</span>
              </div>
            </div>
            <div className="lot-location-allocation-grid">
              {lot.locations.map((location) => {
                const key = `${lot.productionId}-${location.locationId}`;
                const value = allocations[key] ?? 0;
                return <label className={`lot-location-allocation ${value > 0 ? "selected" : ""}`} key={location.locationId}>
                  <span><strong>{location.warehouseName} · {location.code}</strong><small>{location.zoneType === "STACK" ? "Estiba / monte" : "Paletes"} · {location.quantityPackages} {packageLabel(lot.productionUnit, location.quantityPackages)} disponíveis</small></span>
                  <input
                    name={`stock_${lot.productionId}_${location.locationId}`}
                    type="number"
                    min="0"
                    max={location.quantityPackages}
                    step="1"
                    value={value || ""}
                    onChange={(e) => setLocationAllocation(lot.productionId, location.locationId, Number(e.target.value || 0), location.quantityPackages)}
                    placeholder="0"
                  />
                </label>;
              })}
            </div>
            {selectedPackages > 0 && <div className="notice muted">Selecionado deste lote: <strong>{selectedPackages} {packageLabel(lot.productionUnit, selectedPackages)} = {selectedLotUnits.toLocaleString("pt-PT")} artigos</strong></div>}
          </article>;
        })}</div>}
    </section>}

    <div className="notice muted"><strong>Funcionário responsável pelo registo:</strong> {employeeName}</div>
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}

    <div className="button-row">
      <button className="btn primary" type="submit" disabled={saving || target <= 0 || selectedUnits !== target}>
        {saving ? "A registar..." : "Registar saída dos lotes"}
      </button>
    </div>
  </form>;
}
