import { db } from "@/lib/db";
import { requireReadAccess } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";

type DispatchTraceRow = {
  productionId: number;
  customerName: string;
  orderReference: string;
  invoiceNumber: string;
  dispatchDate: string;
  quantityUnits: number | string;
  createdByName: string;
};

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  await requireReadAccess();
  const { q = "" } = await searchParams;

  const linkedIds = q
    ? await db.$queryRaw<{productionId:number;labelCode:string}[]>`
        SELECT productionId,labelCode
        FROM ProductionLotAssociation
        WHERE labelCode LIKE ${`%${q}%`}
        LIMIT 100
      `
    : [];
  const ids = linkedIds.map((x) => x.productionId);

  const rows = q
    ? await db.production.findMany({
        where: {
          OR: [
            { id: { in: ids.length ? ids : [-1] } },
            { productionLot: { contains: q } },
            { product: { name: { contains: q } } },
            { machine: { code: { contains: q } } },
          ],
        },
        include: {
          product: true,
          machine: true,
          operator: true,
          materials: { include: { rawMaterialLot: { include: { rawMaterial: true } } } },
          tests: true,
        },
        orderBy: { startedAt: "desc" },
        take: 30,
      })
    : [];

  const productionIds = rows.map((row) => Number(row.id));
  const dispatchRows = productionIds.length
    ? await db.query<DispatchTraceRow[]>(
        `SELECT
           line.productionId,
           dispatch.customerName,
           dispatch.orderReference,
           dispatch.invoiceNumber,
           DATE_FORMAT(dispatch.dispatchDate, '%Y-%m-%d') AS dispatchDate,
           line.quantityUnits,
           u.name AS createdByName
         FROM LotDispatchLine line
         INNER JOIN LotDispatch dispatch ON dispatch.id = line.lotDispatchId
         INNER JOIN User u ON u.id = dispatch.createdById
         WHERE line.productionId IN (${productionIds.map(() => "?").join(",")})
           AND dispatch.cancelledAt IS NULL
         ORDER BY dispatch.dispatchDate ASC, dispatch.id ASC`,
        productionIds,
      )
    : [];

  const labels = new Map(linkedIds.map((x) => [x.productionId, x.labelCode]));

  return <>
    <PageIntro title="Rastreabilidade" subtitle="Pesquisar por lote comercial, código interno, produto ou máquina."/>
    <section className="panel">
      <form className="inline-form">
        <input name="q" defaultValue={q} placeholder="Lote comercial, controlo interno, produto ou máquina"/>
        <button className="btn primary">Pesquisar</button>
      </form>
    </section>

    {rows.map((r) => {
      const outputs = dispatchRows.filter((row) => Number(row.productionId) === Number(r.id));
      const unitsPerPackage = Number(r.unitsPerPackageSnapshot ?? r.product.unitsPerPackage ?? 0);
      const producedUnits = Number(r.quantityProduced ?? 0) * unitsPerPackage;
      const dispatchedUnits = outputs.reduce((sum, row) => sum + Number(row.quantityUnits), 0);
      const stockUnits = Math.max(0, producedUnits - dispatchedUnits);

      return <section className="panel trace-card" key={r.id}>
        <h2>{labels.get(r.id) || r.productionLot}</h2>
        <div className="detail-grid">
          <p><strong>Produto:</strong> {r.product.name}</p>
          <p><strong>Máquina:</strong> {r.machine.code}</p>
          <p><strong>Turno:</strong> {r.shiftCode}</p>
          <p><strong>Operador:</strong> {r.operator.name}</p>
          <p><strong>Data:</strong> {r.startedAt.toLocaleString("pt-PT")}</p>
          <p><strong>Produção:</strong> {r.quantityProduced ?? "—"} embalagens{unitsPerPackage > 0 ? ` · ${producedUnits.toLocaleString("pt-PT")} artigos` : ""}</p>
          <p><strong>Em stock:</strong> {unitsPerPackage > 0 ? `${stockUnits.toLocaleString("pt-PT")} artigos` : "—"}</p>
        </div>

        <h3>Saídas para clientes</h3>
        {outputs.length === 0
          ? <p className="muted">Este lote ainda não tem saídas registadas para clientes.</p>
          : <div className="responsive-table"><table>
              <thead><tr><th>Data</th><th>Cliente</th><th>Encomenda</th><th>Fatura</th><th>Quantidade</th><th>Registado por</th></tr></thead>
              <tbody>{outputs.map((output, index) => <tr key={index}>
                <td>{new Date(`${output.dispatchDate}T12:00:00`).toLocaleDateString("pt-PT")}</td>
                <td>{output.customerName}</td>
                <td>{output.orderReference}</td>
                <td>{output.invoiceNumber}</td>
                <td>{Number(output.quantityUnits).toLocaleString("pt-PT")} artigos</td>
                <td>{output.createdByName}</td>
              </tr>)}</tbody>
            </table></div>}

        <h3>Matérias-primas</h3>
        {r.materials.map((m:any) => <p key={m.id}>{m.rawMaterialLot.rawMaterial.name} · lote {m.rawMaterialLot.supplierLot} · {Number(m.quantityKg || 0)} kg</p>)}
      </section>;
    })}
  </>;
}
