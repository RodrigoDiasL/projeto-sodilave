import Link from "next/link";
import { ClipboardList, Settings, ShieldCheck, LogOut, CalendarDays, Clock3, RefreshCw, UserRound, Power, PowerOff, Wrench, PlayCircle, ScanSearch, AlertTriangle, Search, Tags, Trophy } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { logoutAction } from "@/app/actions/auth";
import { getActiveWeeklyMachines, getActiveWeeklyStartup } from "@/lib/active-machines";
import { db } from "@/lib/db";
import { getAdminDashboardData } from "@/lib/admin-dashboard";
import { getAdminProductionStats } from "@/lib/admin-production-stats";
import { AdminOperationsDashboard } from "@/components/AdminOperationsDashboard";

const Card=({href,disabled,className,children}:{href:string;disabled?:boolean;className:string;children:React.ReactNode})=>disabled?<div className={`action-card ${className} disabled`} aria-disabled="true">{children}</div>:<Link className={`action-card ${className}`} href={href}>{children}</Link>;

export default async function Dashboard(){
  const user=await requireUser();
  const now=new Date();
  const shift=getShift(now);
  const [startup,machines,stoppedCount]=await Promise.all([
    getActiveWeeklyStartup(),
    getActiveWeeklyMachines(),
    db.machine.count({where:{active:true,status:"STOPPED"}}),
  ]);
  const hasStartup=Boolean(startup);
  const hasRunning=machines.length>0;

  if(user.role==="ADMIN"){
    const [data,productionStats]=await Promise.all([getAdminDashboardData(now),getAdminProductionStats(now)]);
    return <AdminOperationsDashboard name={user.name} data={data} productionStats={productionStats} hasStartup={hasStartup} hasRunning={hasRunning} stoppedCount={stoppedCount}/>;
  }

  if(user.role==="AUDITOR") return <>
    <section className="welcome"><h1>Bem-vinda, {user.name}.</h1><p>Perfil de auditoria: acesso apenas a consultas, sem registo ou alteração de operações.</p></section>
    <section className="summary-card" style={{gridTemplateColumns:"repeat(3,1fr)"}}><div><CalendarDays/><small>DATA</small><strong>{now.toLocaleDateString("pt-PT")}</strong></div><div><Clock3/><small>HORA</small><strong>{now.toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})}</strong></div><div><UserRound/><small>UTILIZADOR</small><strong>{user.name}</strong></div></section>
    <section className="dashboard-section"><h2>Consultas e auditoria</h2><div className="action-grid"><Card className="blue" href="/admin/queries"><Search/><strong>Consultas</strong></Card><Card className="green" href="/scoreboards"><Trophy/><strong>Scoreboards</strong></Card><Card className="orange" href="/commercial-lots"><Tags/><strong>Lotes comerciais e controlo interno</strong></Card><Card className="blue" href="/machines"><Settings/><strong>Estado das máquinas</strong></Card><Card className="green" href="/traceability"><ScanSearch/><strong>Rastreabilidade</strong></Card><form action={logoutAction}><button className="action-card red"><LogOut/><strong>Logout / Sair</strong></button></form></div></section>
    <section className="panel running-machines"><h2>Máquinas em funcionamento</h2>{machines.length?<div className="machine-grid">{machines.map(m=><div className="machine-option static" key={m.id}><img src={['5','6'].includes(m.code)?'/maq-tampas.png':'/maq-garrafoes.png?v=5'} alt=""/><strong>{m.code}</strong></div>)}</div>:<p className="empty-state">Não existem máquinas em funcionamento.</p>}</section>
  </>;

  return <>
    <section className="welcome"><h1>Bem-vindo, {user.name}.</h1><p>Selecione uma opção para começar.</p></section>
    <section className="summary-card"><div><CalendarDays/><small>DATA</small><strong>{now.toLocaleDateString("pt-PT")}</strong></div><div><Clock3/><small>HORA</small><strong>{now.toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})}</strong></div><div><RefreshCw/><small>TURNO ATUAL</small><strong>{shift.label}</strong><span>{shift.hours}</span></div><div><UserRound/><small>UTILIZADOR</small><strong>{user.name}</strong></div></section>
    <section className="dashboard-section"><h2>Ciclo e estado das máquinas</h2><p className="muted">Arranque, ocorrências, alterações de estado e paragem semanal.</p><div className="action-grid five"><Card className="orange" href="/startup" disabled={hasStartup}><Power/><strong>Registar arranque semanal</strong>{hasStartup&&<small>Disponível após a paragem semanal</small>}</Card><Card className="red" href="/incidents" disabled={!hasStartup}><AlertTriangle/><strong>Registar avaria ou paragem</strong>{!hasStartup&&<small>Requer arranque semanal ativo</small>}</Card><Card className="green" href="/intermediate-startup" disabled={!hasStartup||stoppedCount===0}><PlayCircle/><strong>Arranque intermédio</strong>{!hasStartup&&<small>Requer arranque semanal ativo</small>}</Card><Card className="orange" href="/shutdown" disabled={!hasStartup||!hasRunning}><PowerOff/><strong>Registar paragem semanal</strong>{(!hasStartup||!hasRunning)&&<small>Sem máquinas para parar</small>}</Card><Card className="blue" href="/machines"><Settings/><strong>Estado das máquinas</strong></Card></div></section>
    <section className="dashboard-section secondary-actions"><h2>Registos e gestão</h2><div className="action-grid"><Card className="blue" href="/production" disabled={!hasStartup||!hasRunning}><ClipboardList/><strong>Registar produção</strong>{(!hasStartup||!hasRunning)&&<small>Requer máquinas em funcionamento</small>}</Card><Card className="green" href="/checkups" disabled={!hasStartup||!hasRunning}><ShieldCheck/><strong>Verificações de Turno</strong></Card><Card className="green" href="/scoreboards"><Trophy/><strong>Scoreboards</strong></Card>{user.role==="PRODUCTION_MANAGER"&&<><Card className="orange" href="/commercial-lots"><Tags/><strong>Lotes comerciais e controlo interno</strong></Card><Card className="purple" href="/maintenance"><Wrench/><strong>Manutenções</strong></Card><Card className="blue" href="/traceability"><ScanSearch/><strong>Rastreabilidade</strong></Card></>}<form action={logoutAction}><button className="action-card red"><LogOut/><strong>Logout / Sair</strong></button></form></div></section>
    <section className="panel running-machines"><h2>Máquinas em funcionamento</h2>{machines.length?<div className="machine-grid">{machines.map(m=><div className="machine-option static" key={m.id}><img src={['5','6'].includes(m.code)?'/maq-tampas.png':'/maq-garrafoes.png?v=5'} alt=""/><strong>{m.code}</strong></div>)}</div>:<p className="empty-state">Não existem máquinas em funcionamento.</p>}</section>
  </>;
}
