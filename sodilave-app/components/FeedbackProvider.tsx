"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error";
type Notice = { id: number; kind: Kind; message: string };
const FeedbackContext = createContext<(kind: Kind, message: string) => void>(() => {});

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((kind: Kind, message: string) => {
    if (message.trim()) setNotice({ id: Date.now(), kind, message });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  return <FeedbackContext.Provider value={notify}>
    <div onInvalidCapture={() => notify("error", "Não foi possível enviar. Verifique os campos obrigatórios ou inválidos assinalados no formulário.")}>{children}</div>
    {notice && <div key={notice.id} className={`operation-feedback ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"} aria-atomic="true">
      <div><strong>{notice.kind === "success" ? "✓ Operação concluída" : "! Operação não concluída"}</strong><p>{notice.message}</p></div>
      <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button>
    </div>}
  </FeedbackContext.Provider>;
}
export const useFeedback = () => useContext(FeedbackContext);
// Inline feedback and the global notice share the same three-second duration.
export function useFeedbackState(kind: Kind): [string, (value: string) => void] {
  const [value, setValue] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const notify = useFeedback();
  return [value, useCallback((message: string) => {
    const text = kind === "error" && /Server Components render|omitted in production builds|Failed to fetch|fetch failed|NetworkError|unexpected response was received/i.test(message)
      ? "Não foi possível confirmar o registo. Verifique os dados e a ligação; confirme o estado na aplicação antes de repetir."
      : message;
    if (timer.current !== null) clearTimeout(timer.current);
    setValue(text);
    if (text) {
      notify(kind, text);
      timer.current = setTimeout(() => setValue(""), 3000);
    }
  }, [kind, notify])];
}
