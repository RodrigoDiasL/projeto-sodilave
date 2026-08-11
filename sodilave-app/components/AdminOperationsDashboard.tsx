import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  LogOut,
  PlayCircle,
  Power,
  PowerOff,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Trophy,
  Wrench,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import type { ActivityTone, AdminDashboardData, MachineUptime } from "@/lib/admin-dashboard";
import type { AdminProductionStats } from "@/lib/admin-production-stats";
import { AdminProductionCounters } from "@/components/AdminProductionCounters";
import { DashboardRefresh } from "@/components/DashboardRefresh";

const activityLabels: Record<ActivityTone, string> = {
  green: "Concluído sem observações",
  blue: "Concluído com observações",
  yellow: "Em aberto",
  red: "Não conformidade",
  orange: "Conteúdo em falta",
  neutral: "Registo concluído",
};

function UptimeCard({ machine }: { machine: MachineUptime }) {
  return <article className="uptime-card">
    <div className="uptime-card-heading">
      <div>
        <strong>Máquina {machine.code}</strong>
        <small>{machine.name}</small>
      </div>
      <span className={`machine-state-dot ${machine.status === "RUNNING" ? "running" : "stopped"}`}>
        {machine.status === "RUNNING" ? "Operacional" : "Parada"}
      </span>
    </div>
    <div className="uptime-metric">
      <div><span>Semana atual</span><strong>{machine.weeklyPercentage}%</strong></div>
      <div className="uptime-track" aria-label={`Uptime semanal ${machine.weeklyPercentage}%`}>
        <span style={{ width: `${machine.weeklyPercentage}%` }} />
      </div>
      <small>{machine.weeklyHours.toLocaleString("pt-PT", { maximumFractionDigits: 1 })} horas operacionais</small>
    </div>
    <div className="uptime-metric total">
      <div><span>Média total</span><strong>{machine.totalPercentage}%</strong></div>
      <div className="uptime-track" aria-label={`Uptime total ${machine.totalPercentage}%`}>
        <span style={{ width: `${machine.totalPercentage}%` }} />
      </div>
      <small>{machine.cycles} {machine.cycles === 1 ? "ciclo semanal" : "ciclos semanais"}</small>
    </div>
  </article>;
}

function ActionLink({ href, title, icon, disabled = false }: { href: string; title: string; icon: React.ReactNode; disabled?: boolean }) {
  if (disabled) return <div className="admin-side-action disabled" aria-disabled="true">{icon}<span>{title}</span></div>;
  return <Link className="admin-side-action" href={href}>{icon}<span>{title}</span></Link>;
}

export function AdminOperationsDashboard({
  name,
  data,
  productionStats,
  hasStartup,
  hasRunning,
  stoppedCount,
}: {
  name: string;
  data: AdminDashboardData;
  productionStats: AdminProductionStats;
  hasStartup: boolean;
  hasRunning: boolean;
  stoppedCount: number;
}) {
  return <>
    <DashboardRefresh />
    <section className="admin-dashboard-heading">
      <div><h1>Painel operacional</h1><p>Visão consolidada da produção, verificações e disponibilidade das máquinas.</p></div>
      <strong>{name}</strong>
    </section>

    <section className="admin-dashboard-grid">
      <aside className="admin-activity-panel panel">
        <div className="admin-panel-title"><div><h2>Atividade recente</h2><p>Registos mais recentes primeiro</p></div></div>
        <div className="activity-legend">
          {(Object.entries(activityLabels) as [ActivityTone, string][]).slice(0, 5).map(([tone, label]) => <span key={tone}><i className={`activity-dot ${tone}`} />{label}</span>)}
        </div>
        <div className="activity-list">
          {data.activity.length ? data.activity.map((item) => <Link href={item.href} className={`activity-item ${item.tone}`} key={item.key}>
            <div className="activity-item-top"><strong>{item.title}</strong><time>{item.occurredAt.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <p>{item.subtitle}</p>
            <small>{activityLabels[item.tone]}</small>
          </Link>) : <p className="empty-state">Ainda não existem registos.</p>}
        </div>
      </aside>

      <main className="admin-uptime-panel panel">
        <div className="admin-panel-title">
          <div><h2>Uptime das máquinas</h2><p>Semana atual e média de todos os ciclos semanais registados</p></div>
        </div>
        <div className="uptime-grid">
          {data.uptime.length ? data.uptime.map((machine) => <UptimeCard machine={machine} key={machine.id} />) : <p className="empty-state">Não existem dados das máquinas prioritárias.</p>}
        </div>
        <AdminProductionCounters stats={productionStats} />
      </main>

      <aside className="admin-actions-panel panel">
        <div className="admin-panel-title"><div><h2>Registo e gestão</h2><p>Acesso rápido</p></div></div>
        <nav className="admin-side-actions">
          <ActionLink href="/production" title="Registar produção" icon={<ClipboardList />} disabled={!hasStartup || !hasRunning} />
          <ActionLink href="/checkups" title="Verificações de turno" icon={<ShieldCheck />} disabled={!hasStartup || !hasRunning} />
          <ActionLink href="/scoreboards" title="Scoreboards" icon={<Trophy />} />
          <ActionLink href="/admin/queries" title="Consultas" icon={<Search />} />
          <ActionLink href="/commercial-lots" title="Lotes e controlo interno" icon={<Tags />} />
          <ActionLink href="/maintenance" title="Manutenções" icon={<Wrench />} />
          <ActionLink href="/traceability" title="Rastreabilidade" icon={<ScanSearch />} />
          <ActionLink href="/admin" title="Controlos de administrador" icon={<Settings />} />
        </nav>
        <form action={logoutAction} className="admin-dashboard-logout"><button className="admin-side-action logout"><LogOut/><span>Logout / Sair</span></button></form>
      </aside>
    </section>

    <section className="admin-cycle-panel panel">
      <div className="admin-panel-title"><div><h2>Ciclo e estado das máquinas</h2><p>Arranques, ocorrências, paragens e consulta do estado atual.</p></div></div>
      <div className="admin-cycle-actions">
        <ActionLink href="/startup" title="Arranque semanal" icon={<Power />} disabled={hasStartup} />
        <ActionLink href="/incidents" title="Avaria ou paragem" icon={<AlertTriangle />} disabled={!hasStartup} />
        <ActionLink href="/intermediate-startup" title="Arranque intermédio" icon={<PlayCircle />} disabled={!hasStartup || stoppedCount === 0} />
        <ActionLink href="/shutdown" title="Paragem semanal" icon={<PowerOff />} disabled={!hasStartup || !hasRunning} />
        <ActionLink href="/machines" title="Estado das máquinas" icon={<Settings />} />
      </div>
    </section>
  </>;
}
