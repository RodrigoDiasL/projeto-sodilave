"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "success" | "error";
type Notice = { id: number; kind: Kind; message: string };
const FeedbackContext = createContext<(kind: Kind, message: string) => void>(() => {});

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((kind: Kind, message: string) => {
    if (message.trim()) setNotice({ id: Date.now(), kind, message });
  }, []);
  return <FeedbackContext.Provider value={notify}>
    <div onInvalidCapture={() => notify("error", "Não foi possível enviar. Verifique os campos obrigatórios ou inválidos assinalados no formulário.")}>{children}</div>
    {notice && <div key={notice.id} className={`operation-feedback ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"} aria-atomic="true">
      <div><strong>{notice.kind === "success" ? "✓ Operação concluída" : "! Operação não concluída"}</strong><p>{notice.message}</p></div>
      <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button>
    </div>}
  </FeedbackContext.Provider>;
}
export const useFeedback = () => useContext(FeedbackContext);
// Keep existing inline feedback, and also show it above the page after navigation.
export function useFeedbackState(kind: Kind): [string, (value: string) => void] {
  const [value, setValue] = useState("");
  const notify = useFeedback();
  return [value, useCallback((message: string) => {
    const text = kind === "error" && /Server Components render|omitted in production builds|Failed to fetch|fetch failed|NetworkError|unexpected response was received/i.test(message)
      ? "Não foi possível confirmar o registo. Verifique os dados e a ligação; confirme o estado na aplicação antes de repetir."
      : message;
    setValue(text); if (text) notify(kind, text);
  }, [kind, notify])];
}
