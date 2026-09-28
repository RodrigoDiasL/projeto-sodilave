import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminPage } from "@/components/AdminPage";
import { HistoricalImport } from "@/components/HistoricalImport";
export default async function Page(){
 await requireAdmin();const [products,operators,machines,batches]=await Promise.all([db.product.findMany({select:{id:true,name:true,code:true},orderBy:{name:'asc'}}),db.user.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),db.machine.findMany({select:{id:true,name:true,code:true},orderBy:{code:'asc'}}),db.query<any[]>('SELECT b.id,b.fileName,b.createdAt,u.name,COUNT(i.id) AS records FROM HistoricalImportBatch b JOIN User u ON u.id=b.importedById LEFT JOIN HistoricalImportItem i ON i.batchId=b.id GROUP BY b.id,b.fileName,b.createdAt,u.name ORDER BY b.id DESC LIMIT 30')]);
 return <AdminPage title="Importar histórico" subtitle="Integrar produções e lotes de folhas antigas, com revisão antes de gravar."><HistoricalImport products={products} operators={operators} machines={machines}/><section className="panel"><h2>Importações realizadas</h2>{batches.length?<div className="responsive-table"><table><thead><tr><th>Data</th><th>Ficheiro</th><th>Registos</th><th>Importado por</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td>{new Date(b.createdAt).toLocaleString('pt-PT')}</td><td>{b.fileName}</td><td>{b.records}</td><td>{b.name}</td></tr>)}</tbody></table></div>:<p>Ainda não existem importações. Os registos importados ficam disponíveis nas consultas de Produções e Rastreabilidade.</p>}</section></AdminPage>;
}
