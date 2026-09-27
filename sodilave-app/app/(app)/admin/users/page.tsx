import Link from "next/link";
import { FeedbackForm } from "@/components/FeedbackForm";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { createUser, deleteUser, updateUser } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

export default async function Page({searchParams}:{searchParams:Promise<{inactive?:string}>}) {
  const current = await requireAuditAccess();
  const showInactive = (await searchParams).inactive === "1";
  const rows = await db.user.findMany({ where: showInactive ? {} : {active:true}, select: { id:true,name:true,role:true,active:true }, orderBy: { name: "asc" } });
  if(current.role==="AUDITOR") return <AdminPage title="Utilizadores — consulta" subtitle="Colaboradores e permissões, sem acesso a PINs ou alterações.">
    <Link className="btn secondary" href={showInactive?"/admin/users":"/admin/users?inactive=1"}>{showInactive?"Mostrar apenas ativos":"Mostrar inativos"}</Link>
    <table><thead><tr><th>Nome</th><th>Função</th><th>Estado</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{({ADMIN:"Administrador",AUDITOR:"Auditor",LOGISTICS:"Logística e Expedição",OPERATOR:"Operador",PRODUCTION_MANAGER:"Responsável de produção"} as Record<string,string>)[row.role]}</td><td>{row.active?"Ativo":"Inativo"}</td></tr>)}</tbody></table>
  </AdminPage>;
  return <AdminPage title={current.role==="ADMIN"?"Utilizadores e PINs":"Utilizadores — consulta"} subtitle={current.role==="ADMIN"?"Criar colaboradores, alterar PINs, funções e estado de acesso.":"Consultar colaboradores, funções e estado. Sem acesso a PINs ou alterações."}>
    <Link className="btn secondary" href={showInactive?"/admin/users":"/admin/users?inactive=1"}>{showInactive?"Mostrar apenas ativos":"Mostrar inativos"}</Link>
    {current.role === "ADMIN" && <FeedbackForm action={createUser} className="inline-form">
      <input name="name" placeholder="Nome" maxLength={120} required/>
      <input className="no-spinner" name="pin" type="password" placeholder="PIN (8 algarismos)" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} required/>
      <select name="role"><option value="OPERATOR">Operador</option><option value="PRODUCTION_MANAGER">Responsável de produção</option><option value="LOGISTICS">Logística e Expedição</option><option value="AUDITOR">Auditor (só consulta)</option><option value="ADMIN">Administrador</option></select>
      <button className="btn primary">Criar utilizador</button>
    </FeedbackForm>}

    <div className="responsive-table"><table><thead><tr><th>Nome</th><th>Função</th><th>Novo PIN</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.id}:${row.active}:${row.role}:${row.name}`}>
      <td colSpan={5} className="user-editor-cell">
        <p><strong>{row.name}</strong> · {row.active?"Ativo":"Inativo — sem acesso"} · {row.role === "LOGISTICS"?"Logística e Expedição":row.role === "AUDITOR"?"Auditor":row.role}</p>
        {current.role === "ADMIN" && <>
        <FeedbackForm action={updateUser} className="user-editor-form">
          <input type="hidden" name="id" value={row.id}/>
          <input name="name" defaultValue={row.name} maxLength={120} required/>
          <select name="role" defaultValue={row.role} disabled={row.id === current.id}><option value="OPERATOR">Operador</option><option value="PRODUCTION_MANAGER">Responsável de produção</option><option value="LOGISTICS">Logística e Expedição</option><option value="AUDITOR">Auditor (só consulta)</option><option value="ADMIN">Administrador</option></select>
          {row.id === current.id && <input type="hidden" name="role" value="ADMIN"/>}
          <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} placeholder="Manter PIN atual"/>
          <label className="check compact-check"><input type="checkbox" name="active" defaultChecked={row.active} disabled={row.id === current.id}/>Ativo</label>
          {row.id === current.id && <input type="hidden" name="active" value="on"/>}
          <button className="btn secondary">Guardar alterações</button>
        </FeedbackForm>
        {row.active && row.id !== current.id && <FeedbackForm action={deleteUser} className="user-delete-form"><input type="hidden" name="id" value={row.id}/><ConfirmDeleteButton label="Eliminar / desativar" message="Eliminar este utilizador? Se tiver registos, será apenas desativado."/></FeedbackForm>}
        </>}
      </td>
    </tr>)}</tbody></table></div>
  </AdminPage>;
}
