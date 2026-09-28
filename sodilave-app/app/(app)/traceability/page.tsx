import Link from "next/link";
import { db } from "@/lib/db";
import { requireReadAccess } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";

type DispatchTraceRow = {
  dispatchId: number;
  productionId: number;
  customerName: string;
  orderReference: string;
  invoiceNumber: string;
  dispatchDate: string;
  quantityUnits: number | string;
  createdByName: string;
};

type StorageTraceRow = {
  productionId: number;
  warehouseName: string;
  zoneType: string;
  locationCode: string;
  quantityPackages: number | string;
};

type DispatchStorageRow = {
  productionId: number;
  lotDispatchId: number;
  warehouseName: string;
  zoneType: string;
  locationCode: string;
  quantityPackages: number | string;
};

const packageLabel = (unit:string, quantity:number) =>
  unit === "PALLET" ? (quantity === 1 ? "palete" : "paletes") : (quantity === 1 ? "saco" : "sacos");

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  await requireReadAccess();
  const { q = "" } = await searchParams;

  const linkedIds = q ? await db.query<{productionId:number}[]>(`
    SELECT productionId FROM ProductionLotAssociation WHERE labelCode LIKE ?
    UNION SELECT productionId FROM ProductionLotAlias WHERE oldCode LIKE ? OR oldLabel LIKE ?
    LIMIT 100`,Array(3).fill(`%${q}%`)) : [];
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
  const placeholders = productionIds.map(() => "?").join(",");

  const [dispatchRows, storageRows, dispatchStorageRows] = productionIds.length ? await Promise.all([
    db.query<DispatchTraceRow[]>(
      `SELECT
         dispatch.id AS dispatchId,
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
       WHERE line.productionId IN (${placeholders})
         AND dispatch.cancelledAt IS NULL
       ORDER BY dispatch.dispatchDate ASC, dispatch.id ASC`,
      productionIds,
    ),
    db.query<StorageTraceRow[]>(
      `SELECT
         b.productionId,
         l.warehouseName,
         l.zoneType,
         l.code AS locationCode,
         b.quantityPackages
       FROM ProductionStorageBalance b
       INNER JOIN StorageLocation l ON l.id=b.locationId
       WHERE b.productionId IN (${placeholders})
         AND b.quantityPackages > 0
       ORDER BY l.warehouseCode, FIELD(l.zoneType,'STACK','PALLET'), l.rowNumber, l.columnNumber`,
      productionIds,
    ),
    db.query<DispatchStorageRow[]>(
      `SELECT
         m.productionId,
         m.lotDispatchId,
         l.warehouseName,
         l.zoneType,
         l.code AS locationCode,
         m.quantityPackages
       FROM ProductionStorageMovement m
       INNER JOIN StorageLocation l ON l.id=m.fromLocationId
       WHERE m.productionId IN (${placeholders})
         AND m.movementType='DISPATCH'
         AND m.lotDispatchId IS NOT NULL
       ORDER BY m.createdAt ASC, m.id ASC`,
      productionIds,
    ),
  ]) : [[], [], []];

  const aliases = productionIds.length ? await db.query<{productionId:number;oldCode:string;oldLabel:string|null}[]>(
    `SELECT productionId,oldCode,oldLabel FROM ProductionLotAlias WHERE productionId IN (${placeholders}) ORDER BY historyId`,productionIds) : [];

  return <>
    <PageIntro title="Rastreabilidade" subtitle="Pesquisar por lote atual ou anterior, produto ou máquina."/>
    <section className="panel">
      <form className="inline-form">
        <input name="q" defaultValue={q} placeholder="Lote atual ou anterior, produto ou máquina"/>
        <button className="btn primary">Pesquisar</button>
      </form>
    </section>

    {rows.map((r) => {
      const outputs = dispatchRows.filter((row) => Number(row.productionId) === Number(r.id));
      const currentStorage = storageRows.filter((row) => Number(row.productionId) === Number(r.id));
      const unitsPerPackage = Number(r.unitsPerPackageSnapshot ?? r.product.unitsPerPackage ?? 0);
      const productionUnit = String(r.productionUnitSnapshot ?? r.product.productionUnit ?? "BAG");
      const producedPackages = Number(r.quantityProduced ?? 0);
      const producedUnits = producedPackages * unitsPerPackage;
      const dispatchedUnits = outputs.reduce((sum, row) => sum + Number(row.quantityUnits), 0);
      const storedPackages = currentStorage.reduce((sum, row) => sum + Number(row.quantityPackages), 0);
      const stockUnits = storedPackages * unitsPerPackage;
      const saleState = dispatchedUnits >= producedUnits && producedUnits > 0
        ? "Vendido / expedido na totalidade"
        : dispatchedUnits > 0
          ? "Vendido / expedido parcialmente"
          : "Sem saídas para clientes";

      return <section className="panel trace-card" key={r.id}>
        <h2>{r.productionLot}</h2>
        {aliases.some(a=>a.productionId===r.id)&&<p className="muted">Códigos anteriores: {Array.from(new Set(aliases.filter(a=>a.productionId===r.id).map(a=>a.oldLabel||a.oldCode))).join(" · ")}</p>}

        {r.recordOrigin==="HISTORICAL_IMPORT"&&<p className="notice">Produção histórica importada, sem stock físico associado. <Link href={`/admin/import-history/${r.id}`}>Consultar dados da folha original</Link></p>}
        <h3>Produção de origem</h3>
        <div className="detail-grid">
          <p><strong>Produção:</strong> #{r.id}</p>
          <p><strong>Produto:</strong> {r.product.name}</p>
          <p><strong>Máquina:</strong> {r.machine.code}</p>
          <p><strong>Turno:</strong> {r.shiftCode}</p>
          <p><strong>Operador:</strong> {r.operator.name}</p>
          <p><strong>Data:</strong> {r.startedAt.toLocaleString("pt-PT")}</p>
          <p><strong>Produzido:</strong> {producedPackages.toLocaleString("pt-PT")} {packageLabel(productionUnit, producedPackages)}{unitsPerPackage > 0 ? ` · ${producedUnits.toLocaleString("pt-PT")} artigos` : ""}</p>
          <p><strong>Estado comercial:</strong> {saleState}</p>
        </div>

        <h3>Localização atual em armazém</h3>
        {currentStorage.length === 0
          ? <div className="notice muted">{stockUnits === 0 && dispatchedUnits >= producedUnits && producedUnits > 0 ? "O lote já não tem stock físico: foi expedido na totalidade." : "Não existe localização atual registada para este lote."}</div>
          : <div className="responsive-table"><table>
            <thead><tr><th>Armazém</th><th>Zona</th><th>Posição</th><th>Quantidade</th><th>Artigos</th></tr></thead>
            <tbody>{currentStorage.map((storage, index) => {
              const packages = Number(storage.quantityPackages);
              return <tr key={index}>
                <td>{storage.warehouseName}</td>
                <td>{storage.zoneType === "STACK" ? "Estiba / monte" : "Paletes"}</td>
                <td><strong>{storage.locationCode}</strong></td>
                <td>{packages} {packageLabel(productionUnit, packages)}</td>
                <td>{(packages * unitsPerPackage).toLocaleString("pt-PT")}</td>
              </tr>;
            })}</tbody>
          </table></div>}

        <h3>Saídas para clientes</h3>
        {outputs.length === 0
          ? <p className="muted">Este lote ainda não tem saídas registadas para clientes.</p>
          : <div className="responsive-table"><table>
              <thead><tr><th>Saída</th><th>Data</th><th>Cliente</th><th>Encomenda</th><th>Fatura</th><th>Quantidade</th><th>Retirado de</th><th>Registado por</th></tr></thead>
              <tbody>{outputs.map((output) => {
                const positions = dispatchStorageRows.filter((movement) =>
                  Number(movement.productionId) === Number(r.id) &&
                  Number(movement.lotDispatchId) === Number(output.dispatchId)
                );
                return <tr key={output.dispatchId}>
                  <td><strong>#{output.dispatchId}</strong></td>
                  <td>{new Date(`${output.dispatchDate}T12:00:00`).toLocaleDateString("pt-PT")}</td>
                  <td>{output.customerName}</td>
                  <td>{output.orderReference}</td>
                  <td>{output.invoiceNumber}</td>
                  <td>{Number(output.quantityUnits).toLocaleString("pt-PT")} artigos</td>
                  <td>{positions.length ? positions.map((position) => {
                    const packages = Number(position.quantityPackages);
                    return `${position.warehouseName} / ${position.locationCode}: ${packages} ${packageLabel(productionUnit, packages)}`;
                  }).join(" · ") : "Sem detalhe de posição (registo anterior)"}</td>
                  <td>{output.createdByName}</td>
                </tr>;
              })}</tbody>
            </table></div>}

        <h3>Matérias-primas</h3>
        {r.materials.map((m:any) => <p key={m.id}>{m.rawMaterialLot.rawMaterial.name} · lote {m.rawMaterialLot.supplierLot} · Fabricante: {m.rawMaterialLot.manufacturer || "—"} · Fornecedor: {m.rawMaterialLot.supplier || "—"} · {Number(m.quantityKg || 0)} kg</p>)}
      </section>;
    })}
  </>;
}
