"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Erro de aplicação", error.digest || "sem digest");
  }, [error]);

  return <main className="center-page">
    <section className="panel narrow">
      <h1>Não foi possível concluir esta operação</h1>
      <p>Ocorreu um erro inesperado. Os detalhes técnicos não são apresentados por motivos de segurança.</p>
      <button className="btn primary" onClick={() => reset()}>Tentar novamente</button>
    </section>
  </main>;
}
