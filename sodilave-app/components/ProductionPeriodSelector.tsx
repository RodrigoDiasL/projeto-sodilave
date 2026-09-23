import Link from "next/link";
import { formatLocalDateInput, getShiftWindow } from "@/lib/shift";

export function ProductionPeriodSelector({ enabled, date, shift }: { enabled: boolean; date?: string; shift?: string }) {
  const now = new Date();
  const current = getShiftWindow(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return <section className="panel form-stack" id="passada">
    <div><strong>Data atual: {now.toLocaleDateString("pt-PT")}</strong> · {current.label} ({current.hours})</div>
    {enabled && <details open={Boolean(date)}>
      <summary>Registo de produção passada — selecionar outro dia e turno</summary>
      <p className="muted">Escolha um turno já terminado. É permitido um registo por máquina, dia e turno.</p>
      <form action="/production/new" method="get" className="inline-form">
        <label>Dia<input type="date" name="date" defaultValue={date ?? formatLocalDateInput(yesterday)} max={formatLocalDateInput(now)} required/></label>
        <label>Turno<select name="shift" defaultValue={shift ?? "A"}><option value="A">Turno A · 00:00–08:00</option><option value="B">Turno B · 08:00–16:00</option><option value="C">Turno C · 16:00–24:00</option></select></label>
        <button className="btn primary" type="submit">Preencher produção passada</button>
        {date && <Link className="btn secondary" href="/production/new">Voltar ao turno atual</Link>}
      </form>
    </details>}
  </section>;
}
