import { requireAdmin } from "@/lib/auth";
import { AdminPage } from "@/components/AdminPage";
import { OperationSettingsForm } from "@/components/OperationSettingsForm";
import { getPastProductionEnabled } from "@/lib/operation-settings";

export default async function SettingsPage() {
  await requireAdmin();
  const enabled = await getPastProductionEnabled();
  return <AdminPage title="Definições de operação" subtitle="Permissões globais para o registo de produção.">
    <OperationSettingsForm enabled={enabled}/>
  </AdminPage>;
}
