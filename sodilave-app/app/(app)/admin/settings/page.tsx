import { requireAuditAccess } from "@/lib/auth";
import { AdminPage } from "@/components/AdminPage";
import { OperationSettingsForm } from "@/components/OperationSettingsForm";
import { getPastProductionEnabled } from "@/lib/operation-settings";

export default async function SettingsPage() {
  const user=await requireAuditAccess();
  const enabled = await getPastProductionEnabled();
  return <AdminPage title="Definições de operação" subtitle="Permissões globais para o registo de produção.">
    {user.role==="ADMIN"?<OperationSettingsForm enabled={enabled}/>:<p>Registo de produção passada: <strong>{enabled?"Permitido":"Desativado"}</strong></p>}
  </AdminPage>;
}
