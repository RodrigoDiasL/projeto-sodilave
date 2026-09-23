import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createUser, deleteUser, updateUser } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

export default async function Page() {
  const current = await requireAdmin();
  const rows = await db.user.findMany({ select: { id:true,name:true,role:true,active:true }, orderBy: { name: "asc" } });
  return <AdminPage title="Utilizadores e PINs" subtitle="Criar colaboradores, alterar PINs, funções e estado de acesso.">
    <form action={createUser} className="inline-form">
      <input name="name" placeholder="Nome" maxLength={120} required/>
      <input className="no-spinner" name="pin" type="password" placeholder="PIN (8 algarismos)" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} required/>
      <select name="role"><option value="OPERATOR">Operador</option><option value="PRODUCTION_MANAGER">Responsável de produção</option><option value="ADMIN">Administrador</option></select>
      <button className="btn primary">Criar utilizador</button>
    </form>

    <div className="responsive-table"><table><thead><tr><th>Nome</th><th>Função</th><th>Novo PIN</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td colSpan={5} className="user-editor-cell">
        <form action={updateUser} className="user-editor-form">
          <input type="hidden" name="id" value={row.id}/>
          <input name="name" defaultValue={row.name} maxLength={120} required/>
          <select name="role" defaultValue={row.role} disabled={row.id === current.id}><option value="OPERATOR">Operador</option><option value="PRODUCTION_MANAGER">Responsável de produção</option><option value="ADMIN">Administrador</option></select>
          {row.id === current.id && <input type="hidden" name="role" value="ADMIN"/>}
          <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} placeholder="Manter PIN atual"/>
          <label className="check compact-check"><input type="checkbox" name="active" defaultChecked={row.active} disabled={row.id === current.id}/>Ativo</label>
          {row.id === current.id && <input type="hidden" name="active" value="on"/>}
          <button className="btn secondary">Guardar alterações</button>
        </form>
        {row.id !== current.id && <form action={deleteUser} className="user-delete-form"><input type="hidden" name="id" value={row.id}/><ConfirmDeleteButton label="Eliminar / desativar" message="Eliminar este utilizador? Se tiver registos, será apenas desativado."/></form>}
      </td>
    </tr>)}</tbody></table></div>
  </AdminPage>;
}
