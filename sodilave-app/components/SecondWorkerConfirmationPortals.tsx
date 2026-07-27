"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SecondWorkerConfirmation } from "@/components/SecondWorkerConfirmation";

type Worker = { id: number; name: string };

export function SecondWorkerConfirmationPortals({ workers, selector }: { workers: Worker[]; selector: string }) {
  const [targets, setTargets] = useState<HTMLFormElement[]>([]);

  useEffect(() => {
    const refresh = () => setTargets(Array.from(document.querySelectorAll<HTMLFormElement>(selector)));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);

  return <>{targets.map((form, index) => createPortal(
    <SecondWorkerConfirmation workers={workers} />,
    form,
    `second-worker-${index}`,
  ))}</>;
}
