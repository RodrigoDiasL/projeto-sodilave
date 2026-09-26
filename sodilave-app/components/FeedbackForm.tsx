"use client";
import { useRef, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { useFeedback } from "@/components/FeedbackProvider";

type Props = Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (data: FormData) => Promise<unknown>;
  successMessage?: string;
};
export function FeedbackForm({ action, successMessage = "Registo guardado com sucesso.", children, ...props }: Props) {
  const notify = useFeedback(); const router = useRouter();
  const inFlight = useRef(false); const [busy, setBusy] = useState(false);
  return <form {...props} aria-busy={busy} onSubmit={async event => {
    event.preventDefault(); if (inFlight.current) return;
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    inFlight.current = true; setBusy(true);
    try { await action(data); notify("success", successMessage); router.refresh(); }
    catch { notify("error", "Não foi possível concluir o registo. Verifique os dados e a ligação; atualize a página para confirmar o estado antes de repetir."); }
    finally { inFlight.current = false; setBusy(false); }
  }}><fieldset className="feedback-form-fields" disabled={busy}>{children}</fieldset></form>;
}
