"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("sodilave-theme"); } catch { /* Browser storage may be blocked. */ }
    const enabled = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", enabled);
    setDark(enabled);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("sodilave-theme", next ? "dark" : "light"); } catch { /* The current theme still works for this page. */ }
  };

  return <button type="button" className="theme-toggle" onClick={toggle} title={dark ? "Ativar modo claro" : "Ativar modo escuro"} aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}>{dark ? <Sun/> : <Moon/>}</button>;
}
