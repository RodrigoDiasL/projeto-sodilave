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

export function LotDispatchForm({ lots, employeeName }: { lots: AvailableFinishedLot[]; employeeName: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [productId, setProductId] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("");
  const [allocations, setAllocations] = useState<Record<number, number>>({});
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

  const totalAvailable = filteredLots.reduce((sum, lot) => sum + lot.availableUnits, 0);
  const allocatedTotal = filteredLots.reduce((sum, lot) => sum + (allocations[lot.productionId] ?? 0), 0);
  const target = Number(orderQuantity || 0);
  const difference = target - allocatedTotal;

  const updateAllocation = (productionId: number, value: number, max: number) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), max)) : 0;
    setAllocations((current) => ({ ...current, [productionId]: safe }));
  };

  const fillFifo = () => {
    if (!Number.isInteger(target) || target <= 0) {
      setError("Introduza primeiro a quantidade da encomenda.");
      return;
    }
    let remaining = target;
    const next: Record<number, number> = {};
    for (const lot of filteredLots) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, lot.availableUnits);
      if (quantity > 0) next[lot.productionId] = quantity;
      remaining -= quantity;
    }
    setAllocations(next);
    setError(remaining > 0 ? `O stock disponível é insuficiente. Faltam ${remaining} artigo(s).` : "");
  };

  const submit = async (fd: FormData) => {
    setMessage("");
    setError("");
    if (!productId) { setError("Selecione o artigo da encomenda."); return; }
    if (!Number.isInteger(target) || target <= 0) { setError("Introduza uma quantidade válida."); return; }
    if (allocatedTotal !== target) {
      setError(`Os lotes selecionados totalizam ${allocatedTotal} artigo(s), mas a encomenda tem ${target}.`);
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
              {product.code} — {product.name} · {product.availableUnits.toLocaleString("pt-PT")} un. disponíveis
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
        <div><span>Stock disponível</span><strong>{totalAvailable.toLocaleString("pt-PT")} artigos</strong></div>
        <div><span>Selecionado</span><strong>{allocatedTotal.toLocaleString("pt-PT")} artigos</strong></div>
        <div className={difference === 0 && target > 0 ? "complete" : difference < 0 ? "excess" : ""}>
          <span>{difference < 0 ? "Excesso" : "Falta selecionar"}</span>
          <strong>{Math.abs(difference).toLocaleString("pt-PT")} artigos</strong>
        </div>
        <button type="button" className="btn secondary" onClick={fillFifo}>Preencher automaticamente por lotes mais antigos</button>
      </div>}
    </section>

    {productId && <section className="subpanel">
      <div className="section-heading">
        <div><h2>Lotes disponíveis em stock</h2><p className="muted small">Pode usar um ou vários lotes. A soma tem de corresponder exatamente à quantidade da encomenda.</p></div>
      </div>

      {filteredLots.length === 0
        ? <p className="empty-state">Não existem lotes com stock disponível para este artigo.</p>
        : <div className="responsive-table"><table className="lot-dispatch-table">
          <thead><tr><th>Lote</th><th>Produção</th><th>Máquina</th><th>Disponível</th><th>Quantidade desta encomenda</th></tr></thead>
          <tbody>{filteredLots.map((lot) => {
            const allocated = allocations[lot.productionId] ?? 0;
            return <tr key={lot.productionId} className={allocated > 0 ? "selected-stock-lot" : ""}>
              <td><strong>{lot.lotCode}</strong><small>{lot.productCode}</small></td>
              <td>{new Date(`${lot.productionDate}T12:00:00`).toLocaleDateString("pt-PT")}<small>{lot.producedPackages.toLocaleString("pt-PT")} embalagens × {lot.unitsPerPackage} un.</small></td>
              <td>{lot.machineCode}</td>
              <td><strong>{lot.availableUnits.toLocaleString("pt-PT")} un.</strong>{lot.dispatchedUnits > 0 && <small>{lot.dispatchedUnits.toLocaleString("pt-PT")} un. já expedidas</small>}</td>
              <td>
                <input
                  name={`lot_${lot.productionId}`}
                  type="number"
                  min="0"
                  max={lot.availableUnits}
                  step="1"
                  value={allocated || ""}
                  onChange={(e) => updateAllocation(lot.productionId, Number(e.target.value || 0), lot.availableUnits)}
                  placeholder="0"
                />
              </td>
            </tr>;
          })}</tbody>
        </table></div>}
    </section>}

    <div className="notice muted"><strong>Funcionário responsável pelo registo:</strong> {employeeName}</div>
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}

    <div className="button-row">
      <button className="btn primary" type="submit" disabled={saving || target <= 0 || allocatedTotal !== target}>
        {saving ? "A registar..." : "Registar saída dos lotes"}
      </button>
    </div>
  </form>;
}
