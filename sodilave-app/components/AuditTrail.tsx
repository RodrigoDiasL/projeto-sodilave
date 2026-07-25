const actionLabel = (action: string) => ({ CREATE: "Criado", EDIT: "Editado", SAVE: "Gravado", FINALIZE: "Finalizado" }[action] ?? action);

export function AuditTrail({ rows }: { rows: { id: number; action: string; createdAt: Date; user: { name: string } | null }[] }) {
  return <section className="audit-section"><h2>Histórico do registo</h2>
    {rows.length === 0 ? <p className="muted">Ainda não existe histórico detalhado para este registo.</p> : <div className="responsive-table"><table><thead><tr><th>Ação</th><th>Utilizador</th><th>Data e hora</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{actionLabel(row.action)}</td><td>{row.user?.name ?? "Utilizador removido"}</td><td>{row.createdAt.toLocaleString("pt-PT")}</td></tr>)}</tbody></table></div>}
  </section>;
}
