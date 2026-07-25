import Link from "next/link";
import { db } from "@/lib/db";
import { requireProductionManager } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
export default async function Page(){await requireProductionManager();const rows=await db.machine.findMany({where:{active:true},orderBy:{code:"asc"}});return <><PageIntro title="Estado das máquinas" subtitle="Consultar disponibilidade, incidentes, manutenção e uptime."/><section className="admin-grid">{rows.map(m=><Link className="admin-card" href={`/machines/${m.id}`} key={m.id}><img src={["5","6"].includes(m.code)?"/maq-tampas.png":"/maq-garrafoes.png"} alt="" style={{width:90,height:70,objectFit:"contain"}}/><h2>Máquina {m.code}</h2><p>{m.name}</p><span className={`status-pill ${m.status==="RUNNING"?"active":"inactive"}`}>{m.status==="RUNNING"?"Em funcionamento":"Parada"}</span></Link>)}</section></>}
