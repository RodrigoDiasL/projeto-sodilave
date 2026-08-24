"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="pt">
    <body>
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f8fc", color: "#0c2a57" }}>
        <section style={{ maxWidth: 560, padding: 32, background: "white", borderRadius: 14, border: "1px solid #e5eaf2", textAlign: "center" }}>
          <h1>Aplicação temporariamente indisponível</h1>
          <p>Ocorreu um erro inesperado. Tente novamente. Se o problema persistir, contacte o administrador.</p>
          <button onClick={() => reset()} style={{ padding: "12px 18px", borderRadius: 8, border: 0, background: "#075ed9", color: "white", fontWeight: 700, cursor: "pointer" }}>Tentar novamente</button>
        </section>
      </main>
    </body>
  </html>;
}
