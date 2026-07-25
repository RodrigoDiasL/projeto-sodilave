"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveProduction } from "@/app/actions/production";

type Machine = { id: number; code: string; name: string };
type Product = { id: number; code: string; name: string; unitsPerPackage: number | null };
type RawMaterial = { id: number; name: string };
type Lot = { id: number; supplierLot: string; quantityAvailable: string; rawMaterial: { id: number; name: string } };
type MaterialRowState = { key: number; materialId: string; lotId: string; percentage: number; quantityKg?: string; manualQuantity?: boolean };
type InitialProduction = {
  id: number;
  machineId: number;
  productId: number;
  productionLot: string;
  initialWeightG: string;
  midWeightG: string;
  quantityProduced: string;
  observations: string;
  totalMaterialKg: string;
  materials: MaterialRowState[];
  tests: Record<string, string>;
  exceptionReason?: string;
  exceptionNotes?: string;
};

const results = ["CONFORMING", "NON_CONFORMING", "NOT_PERFORMED"];

function distributePercentages(count: number) {
  if (count <= 1) return [100];
  const base = Math.floor(100 / count / 5) * 5;
  const values = Array.from({ length: count }, () => base);
  values[0] += 100 - values.reduce((sum, value) => sum + value, 0);
  return values;
}

function normalizeRows(rows: MaterialRowState[]) {
  const percentages = distributePercentages(rows.length);
  return rows.map((row, index) => ({ ...row, percentage: percentages[index] }));
}

function formatQuantity(value: number, maxDigits = 3) {
  return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: maxDigits }).format(value);
}

function calculatedQuantity(total: number, percentage: number) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round(total * percentage * 10) / 1000;
}

export function ProductionForm({ machines, products, rawMaterials, lots, initial, fixedMachine, additional = false }: {
  machines: Machine[];
  products: Product[];
  rawMaterials: RawMaterial[];
  lots: Lot[];
  initial?: InitialProduction;
  fixedMachine?: Machine;
  additional?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MaterialRowState[]>(initial?.materials?.length ? initial.materials : [{ key: 0, materialId: "", lotId: "", percentage: 100, quantityKg: "" }]);
  const [productId, setProductId] = useState(String(initial?.productId ?? ""));
  const [initialWeight, setInitialWeight] = useState(initial?.initialWeightG ?? "");
  const [midWeight, setMidWeight] = useState(initial?.midWeightG ?? "");
  const [packageCount, setPackageCount] = useState(initial?.quantityProduced ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const percentageTotal = useMemo(() => rows.reduce((sum, row) => sum + row.percentage, 0), [rows]);
  const product = products.find((p) => String(p.id) === productId);
  const unitsPerPackage = product?.unitsPerPackage ?? 0;
  const averageWeightG = initialWeight && midWeight ? (Number(initialWeight) + Number(midWeight)) / 2 : 0;
  const suggestedTotalKg = averageWeightG > 0 && Number(packageCount) > 0 && unitsPerPackage > 0 ? (averageWeightG * Number(packageCount) * unitsPerPackage) / 1000 : 0;

  useEffect(() => {
    if (!suggestedTotalKg) return;
    setRows((current) => current.map((row) => row.manualQuantity ? row : ({ ...row, quantityKg: String(Math.round(suggestedTotalKg * row.percentage) / 100) })));
  }, [suggestedTotalKg]);

  const addRow = () => {
    setRows((current) => current.length >= 8 ? current : normalizeRows([...current, { key: Date.now(), materialId: "", lotId: "", percentage: 5, quantityKg: "" }]));
  };

  const updateRow = (key: number, patch: Partial<MaterialRowState>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  };

  const updatePercentage = (index: number, value: number) => {
    setRows((current) => {
      if (current.length === 1 || index === current.length - 1) return current;
      const next = current.map((row) => ({ ...row }));
      const minimumForRemaining = 5 * (current.length - index - 1);
      const previousTotal = next.slice(0, index).reduce((sum, row) => sum + row.percentage, 0);
      const maximum = 100 - previousTotal - minimumForRemaining;
      next[index].percentage = Math.max(5, Math.min(value, maximum));

      const remaining = 100 - next.slice(0, index + 1).reduce((sum, row) => sum + row.percentage, 0);
      const tailCount = next.length - index - 1;
      if (tailCount === 1) {
        next[next.length - 1].percentage = remaining;
      } else {
        const tail = distributePercentages(tailCount).map((part) => Math.round((part / 100) * remaining / 5) * 5);
        tail[tail.length - 1] += remaining - tail.reduce((sum, part) => sum + part, 0);
        tail.forEach((part, offset) => { next[index + 1 + offset].percentage = part; });
      }
      return next;
    });
  };

  const removeRow = (key: number) => setRows((current) => normalizeRows(current.filter((row) => row.key !== key)));

  const validateForFinalization = (formData: FormData) => {
    if (!formData.get("machineId")) return "Selecione a máquina.";
    if (additional && !formData.get("exceptionReason")) return "Indique o motivo da produção adicional.";
    if (formData.get("exceptionReason") === "OTHER" && !String(formData.get("exceptionNotes") || "").trim()) return "Explique o motivo da produção adicional.";
    if (!formData.get("productId")) return "Selecione o tipo de embalagem produzido.";
    if (rows.some((row) => !row.materialId || !row.lotId)) return "Selecione a matéria-prima e o lote em todas as linhas da mistura.";
    if (percentageTotal !== 100) return "A mistura tem de totalizar 100%.";
    if (rows.some((row) => row.percentage < 5 || row.percentage > 100 || row.percentage % 5 !== 0)) return "As percentagens devem variar de 5% em 5%.";
    for (const row of rows) {
      const lot = lots.find((item) => String(item.id) === row.lotId);
      const quantity = Number(row.quantityKg || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) return "Introduza as quantidades efetivamente consumidas de todas as matérias-primas.";
      if (lot && quantity > Number(lot.quantityAvailable)) return `A quantidade calculada excede o stock disponível do lote ${lot.supplierLot}.`;
    }
    if (!formData.get("initialWeightG") || !formData.get("midWeightG")) return "Preencha os pesos do início e do meio do turno.";
    if (!formData.get("leakStart") || !formData.get("leakMid") || !formData.get("dropStart") || !formData.get("dropMid")) return "Preencha todos os testes de vedação e de queda.";
    if (formData.get("quantityProduced") === "") return "Introduza a quantidade produzida.";
    return "";
  };

  const submit = async (formData: FormData) => {
    setMessage("");
    setError("");
    const finalize = formData.get("intent") === "finalize";
    if (finalize) {
      const finalizationError = validateForFinalization(formData);
      if (finalizationError) { setError(finalizationError); return; }
      if (!confirm("Tem a certeza de que pretende finalizar esta produção? Depois de finalizada, apenas um administrador poderá alterá-la.")) return;
    }
    setSaving(true);
    try {
      const result = await saveProduction(formData);
      if (result.finalized) {
        router.push("/production");
        router.refresh();
        return;
      }
      setMessage(`Produção ${result.lot || `#${result.id}`} guardada como rascunho. Os campos em falta podem ser preenchidos mais tarde.`);
      if (!initial?.id && !fixedMachine) router.replace(`/production/${result.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar a produção.");
    } finally {
      setSaving(false);
    }
  };

  return <form action={submit} className="panel form-stack machine-production-form">
    {initial?.id && <input type="hidden" name="productionId" value={initial.id}/>} 
    <div className="notice"><strong>Lote do produto produzido:</strong> {initial?.productionLot ?? "Será gerado automaticamente ao gravar"}</div>
    <div className="notice muted"><strong>Rascunhos:</strong> pode gravar o registo mesmo incompleto. A validação integral só é aplicada ao finalizar.</div>
    {fixedMachine ? <><input type="hidden" name="machineId" value={fixedMachine.id}/><div className="machine-form-heading"><img src={["5","6"].includes(fixedMachine.code)?"/maq-tampas.png":"/maq-garrafoes.png"} alt=""/><div><h2>Máquina {fixedMachine.code}</h2><p>{fixedMachine.name}</p></div></div></> : <fieldset><legend>Selecione a máquina *</legend><div className="machine-grid">{machines.map((m) => <label className="machine-option" key={m.id}><input type="radio" name="machineId" value={m.id} defaultChecked={initial?.machineId === m.id}/><img src={["5","6"].includes(m.code)?"/maq-tampas.png":"/maq-garrafoes.png"} alt=""/><strong>{m.code}</strong></label>)}</div></fieldset>}
    {additional && <section className="subpanel exception-panel"><h3>Motivo da produção adicional *</h3><div className="two-col"><label>Motivo<select name="exceptionReason" defaultValue={initial?.exceptionReason ?? ""}><option value="">Selecione</option><option value="MOULD_CHANGE">Alteração de molde / modelo</option><option value="RAW_MATERIAL_CHANGE">Alteração de matérias-primas</option><option value="OTHER">Outra</option></select></label><label>Explicação<textarea name="exceptionNotes" placeholder="Obrigatório quando selecionar Outra" defaultValue={initial?.exceptionNotes ?? ""}/></label></div></section>}
    <div className="two-col">
      <label>Tipo de embalagem produzido *<select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Selecione o tipo de embalagem</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label>
      <div><label>Lotes de matérias-primas consumidas *</label><button type="button" className="btn secondary" onClick={addRow}>+ Adicionar lote</button></div>
    </div>

    <section className="subpanel">
      <div className="two-col mixture-heading">
        <div><h3>Mistura / Lotes utilizados</h3><p className="muted small">A aplicação sugere as quantidades pelo peso médio, embalagens produzidas e unidades por embalagem. O operador pode corrigir os valores reais.</p></div>
        <div className="calculated-field"><span>Consumo total sugerido</span><strong>{suggestedTotalKg > 0 ? `${formatQuantity(suggestedTotalKg)} kg` : "Preencha pesos, produto e quantidade"}</strong></div>
      </div>
      {rows.map((row, index) => <MaterialRow key={row.key} index={index} row={row} isLast={index === rows.length - 1} rawMaterials={rawMaterials} lots={lots} removable={rows.length > 1} calculatedKg={suggestedTotalKg > 0 ? calculatedQuantity(suggestedTotalKg, row.percentage) : 0} onChange={(patch) => updateRow(row.key, patch)} onPercentageChange={(value) => updatePercentage(index, value)} onRemove={() => removeRow(row.key)}/>) }
      <div className="mixture-summary valid">
        <strong>Total: {percentageTotal}%</strong>
        <span>{suggestedTotalKg > 0 ? `${formatQuantity(suggestedTotalKg)} kg sugeridos no total` : "Consumo sugerido ainda indisponível"}</span>
      </div>
    </section>

    <section className="subpanel"><h3>Peso da embalagem (g)</h3><div className="two-col">
      <label>Início do turno<input className="no-spinner" name="initialWeightG" value={initialWeight} onChange={(e)=>setInitialWeight(e.target.value)} type="number" step="1" min="1" max="100000" inputMode="numeric" placeholder="Ex.: 1250"/></label>
      <label>Meio do turno<input className="no-spinner" name="midWeightG" value={midWeight} onChange={(e)=>setMidWeight(e.target.value)} type="number" step="1" min="1" max="100000" inputMode="numeric" placeholder="Ex.: 1250"/></label>
    </div></section>

    <div className="two-col">
      <section className="subpanel"><h3>Teste de vedação</h3><div className="two-col compact"><label>Início<select name="leakStart" defaultValue={initial?.tests.leakStart ?? ""}><option value="">Selecione</option>{results.map((x) => <option key={x} value={x}>{labelResult(x)}</option>)}</select></label><label>Meio<select name="leakMid" defaultValue={initial?.tests.leakMid ?? ""}><option value="">Selecione</option>{results.map((x) => <option key={x} value={x}>{labelResult(x)}</option>)}</select></label></div></section>
      <section className="subpanel"><h3>Teste de queda</h3><div className="two-col compact"><label>Início<select name="dropStart" defaultValue={initial?.tests.dropStart ?? ""}><option value="">Selecione</option>{results.map((x) => <option key={x} value={x}>{labelResult(x)}</option>)}</select></label><label>Meio<select name="dropMid" defaultValue={initial?.tests.dropMid ?? ""}><option value="">Selecione</option>{results.map((x) => <option key={x} value={x}>{labelResult(x)}</option>)}</select></label></div></section>
    </div>

    <label>Quantidade produzida (embalagens: sacos ou paletes)<input className="no-spinner" name="quantityProduced" value={packageCount} onChange={(e)=>setPackageCount(e.target.value)} type="number" step="1" min="0" max="10000000" inputMode="numeric" placeholder="Ex.: 40"/></label>
    <label>Observações / Comentários<textarea name="observations" maxLength={500} placeholder="Escreva aqui observações ou comentários..." defaultValue={initial?.observations}/></label>
    {error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}
    <div className="button-row"><button className="btn secondary" name="intent" value="draft" formNoValidate disabled={saving}>{saving ? "A guardar..." : "Gravar rascunho"}</button><button className="btn primary" name="intent" value="finalize" disabled={saving}>Finalizar e registar produção</button></div>
  </form>;
}

function MaterialRow({ index, row, isLast, rawMaterials, lots, removable, calculatedKg, onChange, onPercentageChange, onRemove }: {
  index: number;
  row: MaterialRowState;
  isLast: boolean;
  rawMaterials: RawMaterial[];
  lots: Lot[];
  removable: boolean;
  calculatedKg: number;
  onChange: (patch: Partial<MaterialRowState>) => void;
  onPercentageChange: (value: number) => void;
  onRemove: () => void;
}) {
  const available = lots.filter((lot) => String(lot.rawMaterial.id) === row.materialId);
  return <div className="material-row material-row-slider">
    <select value={row.materialId} onChange={(e) => onChange({ materialId: e.target.value, lotId: "" })}><option value="">Selecione a matéria-prima</option>{rawMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    <select name={`materialLotId_${index}`} value={row.lotId} onChange={(e) => onChange({ lotId: e.target.value })} disabled={!row.materialId}><option value="">{row.materialId && available.length === 0 ? "Sem lotes disponíveis" : "Selecione o lote"}</option>{available.map((lot) => <option key={lot.id} value={lot.id}>{lot.supplierLot} · {formatQuantity(Number(lot.quantityAvailable))} kg disponíveis</option>)}</select>
    <label className="range-field"><span>Percentagem: <strong>{row.percentage}%</strong>{isLast && <em> (automática)</em>}</span><input name={`percentage_${index}`} type="range" min="5" max="100" step="5" value={row.percentage} disabled={isLast} onChange={(e) => onPercentageChange(Number(e.target.value))}/>{isLast && <input type="hidden" name={`percentage_${index}`} value={row.percentage}/>}</label>
    <label>Quantidade consumida (kg)<input className="no-spinner" name={`quantityKg_${index}`} type="number" min="0" step="0.001" value={row.quantityKg ?? ""} placeholder={calculatedKg > 0 ? `Sugestão: ${formatQuantity(calculatedKg)} kg` : "Quantidade real"} onChange={(e)=>onChange({quantityKg:e.target.value,manualQuantity:true})}/></label>
    {removable && <button type="button" className="icon-btn danger" onClick={onRemove} aria-label="Remover matéria-prima">×</button>}
  </div>;
}

function labelResult(x: string) { return { CONFORMING: "Conforme", NON_CONFORMING: "Não conforme", NOT_PERFORMED: "Não realizado", }[x]; }
