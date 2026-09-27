"use client";
import { productionUnitLabel as packageLabel } from "@/lib/production-unit";
import { useFeedbackState } from "@/components/FeedbackProvider";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SalesOrder } from "@/lib/sales-orders";
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



export function LotDispatchForm({ lots, employeeName, orders, requestId: initialRequestId, initialOrderId="", initialItemId="" }: {
  lots: AvailableFinishedLot[]; employeeName: string; orders:SalesOrder[]; requestId:string; initialOrderId?:string; initialItemId?:string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initialOrder=orders.find(o=>String(o.id)===initialOrderId);
  const initialItem=initialOrder?.items.find(i=>String(i.id)===initialItemId&&i.remainingUnits>0);
  const [selectedOrderId,setSelectedOrderId]=useState(initialOrder?initialOrderId:"");
  const [selectedItemId,setSelectedItemId]=useState(initialItem?initialItemId:"");
  const [requestId,setRequestId]=useState(initialRequestId);
  const inFlight=useRef(false);
  const selectedOrder=orders.find(o=>String(o.id)===selectedOrderId);
  const selectedItem=selectedOrder?.items.find(i=>String(i.id)===selectedItemId);
  const productId=selectedItem?String(selectedItem.productId):"";
  const [orderQuantity, setOrderQuantity] = useState(initialItem?String(initialItem.remainingUnits):"");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [message, setMessage] = useFeedbackState("success");
  const [error, setError] = useFeedbackState("error");
  const [saving, setSaving] = useState(false);

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
      setError("Introduza primeiro a quantidade a expedir.");
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
      ? `Não é possível completar exatamente esta saída com embalagens completas. Faltam ${remaining} artigo(s).`
      : "");
  };

  const submit = async (fd: FormData) => {
    if(inFlight.current)return;
    setMessage("");
    setError("");
    if (!productId) { setError("Selecione o artigo da encomenda."); return; }
    if (!Number.isInteger(target) || target <= 0) { setError("Introduza uma quantidade válida."); return; }
    if (selectedUnits !== target) {
      setError(`As localizações selecionadas totalizam ${selectedUnits} artigo(s), mas esta saída indica ${target}.`);
      return;
    }

    if(!selectedItem || target>selectedItem.remainingUnits){setError("A quantidade excede o que falta entregar nesta encomenda.");return;}
    inFlight.current=true;
    setSaving(true);
    try {
      const result = await createLotDispatch(fd);
      formRef.current?.reset();
      setSelectedOrderId("");setSelectedItemId("");setRequestId(crypto.randomUUID());
      setOrderQuantity("");
      setAllocations({});
      setMessage(`Saída de lotes #${result.id} registada com sucesso.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível registar a saída dos lotes.");
    } finally {
      inFlight.current=false;
      setSaving(false);
    }
  };

  return <form ref={formRef} onSubmit={event=>{event.preventDefault();if(saving)return;void submit(new FormData(event.currentTarget,(event.nativeEvent as SubmitEvent).submitter));}} className="panel form-stack lot-dispatch-form">
    <input type="hidden" name="salesOrderItemId" value={selectedItemId}/>
    <input type="hidden" name="requestId" value={requestId}/>
    <div className="two-col">
      <label>Encomenda registada *
        <select value={selectedOrderId} required disabled={saving} onChange={e=>{setSelectedOrderId(e.target.value);setSelectedItemId("");setOrderQuantity("");setAllocations({});}}>
          <option value="">Selecione a encomenda</option>{orders.map(order=><option key={order.id} value={order.id}>{order.reference} · {order.customerName}{order.customerReference?` · ${order.customerReference}`:""}</option>)}
        </select>
      </label>
      <label>Cliente<input value={selectedOrder?.customerName??""} readOnly placeholder="Preenchido pela encomenda"/></label>
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
          <select value={selectedItemId} required disabled={!selectedOrder||saving} onChange={e=>{
            const item=selectedOrder?.items.find(i=>String(i.id)===e.target.value);setSelectedItemId(e.target.value);
            setOrderQuantity(item?String(item.remainingUnits):"");setAllocations({});
          }}><option value="">Selecione o artigo</option>{selectedOrder?.items.filter(item=>item.remainingUnits>0).map(item=><option key={item.id} value={item.id}>{item.productCode} — {item.productName} · faltam {item.remainingUnits.toLocaleString("pt-PT")} un.</option>)}</select>
        </label>
        <label>Quantidade a expedir nesta saída (artigos) *
          <input
            name="orderedQuantityUnits"
            max={selectedItem?.remainingUnits}
            disabled={saving}
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

      {selectedItem&&<p className="muted">Encomendado: {selectedItem.quantityUnits} · Já entregue: {selectedItem.deliveredUnits} · Em falta: {selectedItem.remainingUnits}. Pode registar uma entrega parcial.</p>}
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

    {!orders.length&&<p className="notice">Não existem encomendas por entregar. Peça ao administrador ou responsável de produção para registar a encomenda em <Link href="/orders">Encomendas</Link>.</p>}
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
