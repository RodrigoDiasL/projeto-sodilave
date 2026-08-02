import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ValidFieldHighlighter } from "@/components/ValidFieldHighlighter";

export default async function AppLayout({children}:{children:React.ReactNode}){
  const user=await requireUser();
  return <div className="app-frame"><AppHeader user={user}/><main className="page-shell">{children}</main><footer>SODILAVE PLÁSTICOS · Gestão de Produção</footer><ValidFieldHighlighter/></div>;
}
