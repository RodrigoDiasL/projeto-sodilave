import type { getStockCounters } from "@/lib/stock-counters";
const n=(value:number)=>value.toLocaleString("pt-PT");
export function StockCounters({data}:{data:Awaited<ReturnType<typeof getStockCounters>>}){
  return <section className="panel stock-counters"><h2>Stock por artigo</h2><p className="muted small">Quantidades em unidades de artigo nos dois armazéns. O total inclui o stock por localizar, apresentado separadamente. Produções importadas apenas para histórico ficam excluídas.</p>
    <div className="stock-counter-grid">{data.families.map(f=><article className="stock-counter stock-family-total" key={f.name}><h3>{f.name} · Total</h3><strong>{n(f.total)}</strong> unidades<p className="small">{n(f.located)} localizadas · {n(f.unlocated)} por localizar</p></article>)}
    {data.articles.map(a=><article className="stock-counter" key={a.id}><h3>{a.name}</h3><span className="muted small">{a.code}</span><p><strong>{n(a.total)}</strong> unidades</p>{a.warehouses.map(w=><p className="small" key={w.name}>{w.name}: <b>{n(w.units)}</b></p>)}<p className="small">Por localizar: <b>{n(a.unlocated)}</b></p></article>)}</div>
  </section>;
}
