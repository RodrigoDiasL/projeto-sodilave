"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sodilave-theme");
    const enabled = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", enabled);
    setDark(enabled);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("sodilave-theme", next ? "dark" : "light");
  };

  return <button type="button" className="theme-toggle" onClick={toggle} title={dark ? "Ativar modo claro" : "Ativar modo escuro"} aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}>{dark ? <Sun/> : <Moon/>}</button>;
}
