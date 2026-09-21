"use client";

type Worker = { id: number; name: string };

export function SecondWorkerConfirmation({ workers, title = "Confirmação do segundo trabalhador" }: { workers: Worker[]; title?: string }) {
  return <section className="subpanel form-stack second-worker-confirmation">
    <div>
      <h3>{title}</h3>
      <p className="muted small">Para finalizar o primeiro registo do turno, selecione o colega presente. Essa pessoa deve introduzir pessoalmente o respetivo PIN de 8 algarismos. A confirmação fica válida para o restante turno.</p>
    </div>
    <div className="two-col">
      <label>Segundo trabalhador *
        <select name="secondWorkerId" defaultValue="">
          <option value="">Selecione o colega</option>
          {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
        </select>
      </label>
      <label>PIN de confirmação *
        <input name="secondWorkerPin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{8}" minLength={8} maxLength={8} placeholder="8 algarismos"/>
      </label>
    </div>
  </section>;
}
