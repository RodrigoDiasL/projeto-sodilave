import { MachineIcon } from "@/components/MachineIcon";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
export default async function Page(){await requireUser();const rows=await db.machine.findMany({where:{active:true},orderBy:{code:"asc"}});return <><PageIntro title="Estado das máquinas" subtitle="Consultar disponibilidade, incidentes, manutenção e uptime."/><section className="admin-grid">{rows.map(m=><Link className="admin-card" href={`/machines/${m.id}`} key={m.id}><MachineIcon code={m.code} style={{width:90,height:70,objectFit:"contain"}}/><h2>Máquina {m.code}</h2><p>{m.name}</p><span className={`status-pill ${m.status==="RUNNING"?"active":"inactive"}`}>{m.status==="RUNNING"?"Em funcionamento":"Parada"}</span></Link>)}</section></>}
