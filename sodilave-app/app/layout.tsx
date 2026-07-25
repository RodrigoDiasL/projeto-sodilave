import type { Metadata } from "next";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = { title: "Sodilave | Gestão de Produção", description: "Aplicação interna de gestão de produção" };

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="pt" suppressHydrationWarning><body>{children}<ThemeToggle/></body></html>;
}
