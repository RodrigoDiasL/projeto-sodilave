import { requireUser } from "@/lib/auth"; import { AppHeader } from "@/components/AppHeader";
export default async function AppLayout({children}:{children:React.ReactNode}){const user=await requireUser();return <><AppHeader user={user}/><main className="page-shell">{children}</main><footer>SODILAVE PLÁSTICOS · Gestão de Produção</footer></>}
