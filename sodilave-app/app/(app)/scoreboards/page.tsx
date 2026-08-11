import { PageIntro } from "@/components/PageIntro";
import { requireUser } from "@/lib/auth";
import { getScoreboardData } from "@/lib/scoreboards";
import styles from "./scoreboards.module.css";

const fmt=(value:number)=>value.toLocaleString("pt-PT");

export default async function ScoreboardsPage(){
  await requireUser();
  const data=await getScoreboardData();
  const annualTotal=data.shifts.reduce((sum,row)=>sum+row.production.year,0);

  return <>
    <PageIntro title="Scoreboards" subtitle="Produção e indicadores operacionais por funcionário e por turno."/>

    <div className={styles.notice}>
      A produção associada a um funcionário corresponde aos turnos em que participou: operador que abriu o registo e segundo trabalhador que confirmou. Como trabalham duas pessoas por turno, a mesma produção pode aparecer no total individual de ambos. O total da fábrica não duplica essas quantidades. Os indicadores de ocorrências mostram o contexto do turno e não atribuem automaticamente responsabilidade individual.
    </div>

    <section className={`panel ${styles.section}`}>
      <div className={styles.sectionLead}><div><h2>Produção por funcionário</h2><p>Ranking ordenado pela produção acumulada no ano corrente.</p></div><small className={styles.stamp}>Atualizado {data.generatedAt.toLocaleString("pt-PT")}</small></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>#</th><th>Funcionário</th><th>Turnos semana</th><th>Semana</th><th>Mês</th><th>Trimestre</th><th>Ano</th><th>Turnos no ano</th></tr></thead><tbody>
        {data.employees.map((row,index)=><tr key={row.userId}><td className={styles.rank}>{index+1}</td><td className={styles.name}><strong>{row.name}</strong><small>{row.active?"Ativo":"Inativo"}</small></td><td className={styles.number}>{fmt(row.shiftsWorked.week)}</td><td className={styles.number}>{fmt(row.production.week)}</td><td className={styles.number}>{fmt(row.production.month)}</td><td className={styles.number}>{fmt(row.production.quarter)}</td><td className={styles.number}>{fmt(row.production.year)}</td><td className={styles.number}>{fmt(row.shiftsWorked.year)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className={`panel ${styles.section}`}>
      <div className={styles.sectionLead}><div><h2>Produção por turno</h2><p>Manhã, tarde e noite, usando os horários atuais da fábrica.</p></div><strong>{fmt(annualTotal)} embalagens no ano</strong></div>
      <div className={styles.shiftCards}>{data.shifts.map(row=><article className={styles.shiftCard} key={row.code}><h3>{row.label} · Turno {row.code}</h3><p>{row.hours}</p><strong>{fmt(row.production.week)}</strong><small>embalagens esta semana</small></article>)}</div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Turno</th><th>Semana</th><th>Mês</th><th>Trimestre</th><th>Ano</th><th>Dias/turnos no ano</th></tr></thead><tbody>
        {data.shifts.map(row=><tr key={row.code}><td className={styles.name}><strong>{row.label} · {row.code}</strong><small>{row.hours}</small></td><td className={styles.number}>{fmt(row.production.week)}</td><td className={styles.number}>{fmt(row.production.month)}</td><td className={styles.number}>{fmt(row.production.quarter)}</td><td className={styles.number}>{fmt(row.production.year)}</td><td className={styles.number}>{fmt(row.workedDays.year)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className={`panel ${styles.section}`}>
      <div className={styles.sectionLead}><div><h2>Ocorrências por funcionário — ano corrente</h2><p>Avarias e paragens são associadas a todos os trabalhadores identificados naquele turno. “Produções com observações” é apenas um sinal para futura análise, não significa necessariamente problema.</p></div></div>
      <div className={styles.tableWrap}><table className={`${styles.table} ${styles.issueTable}`}><thead><tr><th>#</th><th>Funcionário</th><th>Turnos</th><th>Ocorrências</th><th>Avarias</th><th>Paragens</th><th>Não conformidades</th><th>Produções com observações</th></tr></thead><tbody>
        {data.employees.map((row,index)=><tr key={row.userId}><td className={styles.rank}>{index+1}</td><td><strong>{row.name}</strong></td><td className={styles.number}>{fmt(row.shiftsWorked.year)}</td><td className={styles.number}>{fmt(row.problems.incidents)}</td><td className={styles.number}>{fmt(row.problems.breakdowns)}</td><td className={styles.number}>{fmt(row.problems.stoppages)}</td><td className={styles.number}>{fmt(row.problems.nonConformingProductions)}</td><td className={styles.number}>{fmt(row.problems.productionsWithObservations)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className={`panel ${styles.section}`}>
      <div className={styles.sectionLead}><div><h2>Ocorrências por turno — ano corrente</h2><p>Permite comparar o contexto operacional dos três turnos sem confundir reporte com responsabilidade.</p></div></div>
      <div className={styles.tableWrap}><table className={`${styles.table} ${styles.issueTable}`}><thead><tr><th>Turno</th><th>Período</th><th>Dias registados</th><th>Ocorrências</th><th>Avarias</th><th>Paragens</th><th>Não conformidades</th><th>Produções com observações</th></tr></thead><tbody>
        {data.shifts.map(row=><tr key={row.code}><td><strong>{row.label} · {row.code}</strong></td><td>{row.hours}</td><td className={styles.number}>{fmt(row.workedDays.year)}</td><td className={styles.number}>{fmt(row.problems.incidents)}</td><td className={styles.number}>{fmt(row.problems.breakdowns)}</td><td className={styles.number}>{fmt(row.problems.stoppages)}</td><td className={styles.number}>{fmt(row.problems.nonConformingProductions)}</td><td className={styles.number}>{fmt(row.problems.productionsWithObservations)}</td></tr>)}
      </tbody></table></div>
    </section>
  </>;
}
