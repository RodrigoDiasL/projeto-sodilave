import Link from "next/link";
import { db } from "@/lib/db";
import { requireReadAccess } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { ProductLotSettings } from "@/components/ProductLotSettings";
import { DashboardRefresh } from "@/components/DashboardRefresh";
import { formatProductionLot, generatedLotPattern } from "@/lib/lot-code";
import { getShiftWindow } from "@/lib/shift";
export default async function Page({searchParams}:{searchParams:Promise<{productId?:string;q?:string}>}){
  const user=await requireReadAccess(),params=await searchParams,canManage=["ADMIN","PRODUCTION_MANAGER"].includes(user.role);
  const products=await db.query<any[]>(`SELECT p.id,p.code,p.name,p.active,COALESCE(c.majorLetter,'A') majorLetter,COALESCE(c.minorLetter,'A') minorLetter,COALESCE(c.version,0) version FROM Product p LEFT JOIN ProductLotConfig c ON c.productId=p.id ORDER BY p.active DESC,p.name,p.id`);
  const product=products.find(p=>p.id===Number(params.productId))??products[0];
  const q=String(params.q??"").trim().slice(0,120),shift=getShiftWindow();
  const [machines,lots,history]=product?await Promise.all([
    db.query<any[]>("SELECT m.code FROM Machine m JOIN ProductMachine pm ON pm.machineId=m.id WHERE pm.productId=? AND m.active=1 ORDER BY m.code",[product.id]),
    db.query<any[]>(`SELECT productionLot AS code,COUNT(*) AS records,MIN(id) AS firstId,MIN(startedAt) AS firstDate,MAX(startedAt) AS lastDate,SUM(COALESCE(quantityProduced,0)) AS quantity FROM Production p WHERE productId=? AND recordOrigin='PRODUCTION' AND status<>'CANCELLED' AND (?='' OR productionLot LIKE ? OR EXISTS (SELECT 1 FROM ProductionLotAlias a WHERE a.productionId=p.id AND (a.oldCode LIKE ? OR a.oldLabel LIKE ?))) GROUP BY productionLot ORDER BY lastDate DESC,firstId DESC LIMIT 100`,[product.id,q,`%${q}%`,`%${q}%`,`%${q}%`]),
    db.query<any[]>("SELECT h.*,u.name AS changedBy FROM ProductLotHistory h JOIN User u ON u.id=h.changedById WHERE productId=? ORDER BY h.id DESC LIMIT 100",[product.id]),
  ]):[[],[],[]];
  const examples=machines.map(m=>({code:m.code,suffix:formatProductionLot(m.code,shift.code,shift.start).slice(2)}));
  return <><DashboardRefresh/><PageIntro title="Lotes por produto" subtitle="Escolha as duas letras do produto. A app completa o código do saco com o turno, data e máquina da produção."/>
    <section className="panel form-stack"><h2>1. Escolher o produto</h2><form className="inline-form" method="get"><label>Produto<select name="productId" defaultValue={product?.id}>{products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}{p.active?"":" (inativo)"}</option>)}</select></label><button className="btn secondary">Abrir produto</button></form>
      <p>As letras pertencem ao artigo. Dois produtos podem usar AA, mesmo quando são produzidos na mesma máquina. Uma troca de molde ou de produto não altera as letras automaticamente.</p>
      <p className="muted">Turno A: 00h–08h · Turno B: 08h–16h · Turno C: 16h–24h. A data é a da produção; dia da semana: 1 = segunda-feira, …, 6 = sábado, 0 = domingo.</p>
    </section>
    {product?<>
      <section className="panel form-stack"><h2>2. Letras para novos registos — {product.name}</h2><p>Letras atuais: <strong>{product.majorLetter}{product.minorLetter}</strong> · pré-visualização de {shift.start.toLocaleDateString("pt-PT")} · {shift.label}.</p>
        {canManage&&product.active?<ProductLotSettings key={`${product.id}:${product.version}`} productId={product.id} prefix={product.majorLetter+product.minorLetter} version={Number(product.version)} examples={examples}/>:<p>Consulta das letras atuais. {product.active?"Só administradores e responsáveis de produção podem alterar.":"Reative o produto para configurar novos registos."}</p>}
      </section>
      <section className="panel form-stack"><h2>3. Lotes já registados</h2><form className="inline-form" method="get"><input type="hidden" name="productId" value={product.id}/><input name="q" defaultValue={q} placeholder="Pesquisar código atual ou anterior" aria-label="Pesquisar lote"/><button className="btn secondary">Pesquisar</button></form>
        {!lots.length&&<p>Ainda não existem lotes de produção para esta seleção. O primeiro código será criado automaticamente ao guardar a produção.</p>}
        {lots.map(lot=><article className="subpanel form-stack" key={lot.code}><div className="section-heading"><div><h3>{lot.code}</h3><p>{Number(lot.records)} registo(s) · {new Date(lot.firstDate).toLocaleDateString("pt-PT")} · {Number(lot.quantity).toLocaleString("pt-PT")} embalagens registadas</p></div><Link className="btn secondary" href={`/traceability?q=${encodeURIComponent(lot.code)}`}>Rastreabilidade</Link></div>
          {canManage&&generatedLotPattern.test(lot.code)&&<details><summary>Editar as duas letras deste lote</summary><ProductLotSettings productId={product.id} prefix={lot.code.slice(0,2)} existing={{code:lot.code,count:Number(lot.records)}}/></details>}
        </article>)}
        {lots.length===100&&<p>Mostrados os 100 lotes mais recentes. Use a pesquisa para encontrar um lote anterior.</p>}
      </section>
      <section className="panel"><h2>Histórico de alterações deste produto</h2>{!history.length?<p>Ainda não foram alteradas as letras neste ecrã.</p>:<div className="responsive-table"><table><thead><tr><th>Data / utilizador</th><th>Âmbito</th><th>Anterior → novo</th><th>Alteração e motivo</th></tr></thead><tbody>{history.map(h=><tr key={h.id}><td>{new Date(h.createdAt).toLocaleString("pt-PT")}<br/>{h.changedBy}</td><td>{h.scope==="FUTURE"?"Novos registos":"Lote já registado"}</td><td>{h.previousCode??h.previousPrefix} → {h.newCode??h.newPrefix}</td><td>{h.reason}</td></tr>)}</tbody></table></div>}</section>
    </>:<div className="notice">Crie primeiro os produtos no catálogo.</div>}
  </>;
}
