import type { AdminProductionStats } from "@/lib/admin-production-stats";
import styles from "./AdminProductionCounters.module.css";

const fmt=(value:number)=>value.toLocaleString("pt-PT");

export function AdminProductionCounters({stats}:{stats:AdminProductionStats}){
  return <section className={styles.wrap}>
    <div className={styles.heading}>
      <div><h3>Produção por máquina</h3><p>Quantidade de embalagens finalizadas por período.</p></div>
      <div className={styles.totals}><span className={styles.pill}>Hoje <strong>{fmt(stats.todayProduced)}</strong></span><span className={styles.pill}>Total <strong>{fmt(stats.totalProduced)}</strong></span></div>
    </div>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Máquina</th><th>Dia</th><th>Semana</th><th>Mês</th><th>Trimestre</th><th>Semestre</th><th>Ano</th><th>Total</th></tr></thead><tbody>
      {stats.machines.map(row=><tr key={row.machineId}><td className={styles.machine}><strong>Máquina {row.code}</strong><small>{row.name}</small></td><td className={styles.number}>{fmt(row.day)}</td><td className={styles.number}>{fmt(row.week)}</td><td className={styles.number}>{fmt(row.month)}</td><td className={styles.number}>{fmt(row.quarter)}</td><td className={styles.number}>{fmt(row.semester)}</td><td className={styles.number}>{fmt(row.year)}</td><td className={styles.number}>{fmt(row.total)}</td></tr>)}
    </tbody></table></div>
    <small className={styles.stamp}>Atualização automática a cada 30 segundos · {stats.refreshedAt.toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</small>
  </section>;
}
