import Link from "next/link";
import { notFound } from "next/navigation";
import { requireReadAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminPage } from "@/components/AdminPage";
export default async function Page({params}:{params:Promise<{id:string}>}){
 await requireReadAccess();const {id}=await params;const [row]=await db.query<any[]>('SELECT i.payloadJson,b.fileName,b.createdAt,u.name FROM HistoricalImportItem i JOIN HistoricalImportBatch b ON b.id=i.batchId JOIN User u ON u.id=b.importedById WHERE i.productionId=?',[Number(id)]);if(!row)notFound();const payload=typeof row.payloadJson==='string'?JSON.parse(row.payloadJson):row.payloadJson;
 return <AdminPage title="Origem da produção histórica" subtitle="Dados preservados da folha antiga e correspondências aprovadas na importação."><section className="panel"><p><b>Ficheiro:</b> {row.fileName}</p><p><b>Importado por:</b> {row.name} · {new Date(row.createdAt).toLocaleString('pt-PT')}</p><p>Sem movimentação de stock ou consumo de matérias-primas atuais. Leituras e textos antigos são conservados abaixo tal como recebidos.</p><h2>Dados da folha e registo importado</h2><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(payload,null,2)}</pre><Link className="btn secondary" href={`/admin/productions/${id}`}>Consultar produção</Link></section></AdminPage>;
}
