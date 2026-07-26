import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { IncidentForm } from "@/components/IncidentForm";
import { getActiveWeeklyStartup } from "@/lib/active-machines";

export default async function Page(){
  await requireOperationalUser();
  const startup=await getActiveWeeklyStartup();
  if(!startup)return <><PageIntro title="Registar avaria ou paragem" subtitle="Registe ocorrências que afetem o funcionamento das máquinas."/><section className="panel"><p className="empty-state">Não existe um arranque semanal ativo. O registo de ocorrências está indisponível.</p></section></>;
  const machines=await db.machine.findMany({where:{active:true},orderBy:{code:"asc"}});
  return <><PageIntro title="Registar avaria ou paragem" subtitle="Registe ocorrências que afetem o funcionamento das máquinas."/><section className="panel"><IncidentForm machines={machines}/></section></>;
}
