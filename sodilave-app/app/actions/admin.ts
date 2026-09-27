"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, type DbTransaction } from "@/lib/db";
import { assertPinAvailable, assertValidPin } from "@/lib/pin-policy";
import { cancelProduction } from "@/app/actions/production-admin";
import { RecordStatus, UserRole } from "@/lib/db-types";

async function lockCredentials(tx: DbTransaction, adminId: number) {
  await tx.query("SELECT id FROM CredentialLock WHERE id=1 FOR UPDATE");
  const admin = await tx.user.findFirst({ where: { id: adminId, active: true, role: "ADMIN" } });
  if (!admin) throw new Error("O acesso de administrador foi alterado. Inicie sessão novamente.");
}

const text = (fd: FormData, key: string, max = 120) => String(fd.get(key) || "").trim().slice(0, max);
const positiveNumber = (fd: FormData, key: string, label: string, max = 999999999) => {
  const value = Number(fd.get(key));
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error(`${label} tem um valor inválido.`);
  return value;
};
const positiveId = (fd: FormData) => {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Identificador inválido.");
  return id;
};
const requireText = (value: string, label: string) => { if (!value) throw new Error(`${label} é obrigatório.`); return value; };
const machineIds = (fd: FormData) => {
  const ids = fd.getAll("machineIds").map(Number).filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error("Selecione pelo menos uma máquina que possa produzir este produto.");
  return [...new Set(ids)];
};
async function replaceProductMachines(tx: DbTransaction, productId: number, ids: number[]) {
  const valid = await tx.machine.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
  if (valid.length !== ids.length) throw new Error("Uma das máquinas selecionadas é inválida ou está inativa.");
  await tx.$executeRaw`DELETE FROM ProductMachine WHERE productId=${productId}`;
  for (const machineId of ids) await tx.$executeRaw`INSERT INTO ProductMachine (productId,machineId) VALUES (${productId},${machineId})`;
}

export async function createUser(formData: FormData) {
  const admin = await requireAdmin();
  const name = requireText(text(formData, "name"), "O nome");
  const pin = String(formData.get("pin") || "").trim();
  const role = text(formData, "role", 20) as UserRole;
  assertValidPin(pin);
  if (!Object.values(UserRole).includes(role)) throw new Error("Perfil inválido.");
  const pinHash = await bcrypt.hash(pin, 12);
  await db.$transaction(async tx => {
    await lockCredentials(tx, admin.id);
    await assertPinAvailable(pin, undefined, tx);
    const row = await tx.user.create({ data: { name, pinHash, role, active: true } });
    await tx.auditLog.create({ data: { userId: admin.id, action: "CREATE", entity: "User", entityId: String(row.id) } });
  });
  revalidatePath("/admin/users");
}

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = positiveId(formData);
  const name = requireText(text(formData, "name"), "O nome");
  const pin = String(formData.get("pin") || "").trim();
  const role = text(formData, "role", 20) as UserRole;
  const active = formData.get("active") === "on";
  if (!Object.values(UserRole).includes(role)) throw new Error("Perfil inválido.");
  if (pin) {
    assertValidPin(pin, "O novo PIN");
  }
  if (id === admin.id && (!active || role !== UserRole.ADMIN)) throw new Error("Não pode retirar o seu próprio acesso de administrador nem desativar a conta com sessão iniciada.");
  const data: { name: string; role: UserRole; active: boolean; pinHash?: string } = { name, role, active };
  if (pin) data.pinHash = await bcrypt.hash(pin, 12);
  await db.$transaction(async tx => {
    await lockCredentials(tx, admin.id);
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new Error("O utilizador já não existe.");
    if (pin) await assertPinAvailable(pin, id, tx);
    await tx.user.update({ where: { id }, data });
    if (pin || current.role !== role || Boolean(current.active) !== active) {
      await tx.execute("UPDATE User SET sessionVersion=sessionVersion+1 WHERE id=?", [id]);
      await tx.execute("DELETE FROM AuthSession WHERE userId=?", [id]);
      await tx.execute("DELETE FROM ShiftPeerConfirmation WHERE operatorId=? OR confirmedById=?", [id, id]);
    }
    await tx.auditLog.create({ data: { userId: admin.id, action: "EDIT", entity: "User", entityId: String(id), details: { name, role, active, pinChanged: Boolean(pin) } } });
  });
  revalidatePath("/admin/users");
}

export async function createMachine(formData: FormData) {
  await requireAdmin();
  await db.machine.create({ data: { code: requireText(text(formData, "code", 30), "O código"), name: requireText(text(formData, "name"), "O nome"), active: true } });
  revalidatePath("/admin/machines");
}
export async function createProduct(formData: FormData) {
  const admin=await requireAdmin();
  const ids=machineIds(formData);
  const unitsPerPackage = formData.get("productionUnit") === "UNIT" ? 1 : positiveNumber(formData, "unitsPerPackage", "As unidades por embalagem", 100000);
  if (!Number.isInteger(unitsPerPackage)) throw new Error("As unidades por embalagem devem ser um número inteiro.");
  const productionUnit = text(formData, "productionUnit", 16) || "BAG";
  if (!["BAG","PALLET","UNIT"].includes(productionUnit)) throw new Error("A unidade de produção é inválida.");
  await db.$transaction(async tx => {
  const row=await tx.product.create({ data: { code: requireText(text(formData, "code", 40), "O código"), name: requireText(text(formData, "name"), "A designação"), unitsPerPackage, productionUnit, active: true } });
  await replaceProductMachines(tx,row.id,ids);
  await tx.auditLog.create({data:{userId:admin.id,action:"CREATE",entity:"Product",entityId:String(row.id),details:{machineIds:ids}}});
  });
  revalidatePath("/admin/products"); revalidatePath("/production");
}

export async function updateProduct(formData: FormData) {
  const admin=await requireAdmin();
  const id = positiveId(formData);
  const ids=machineIds(formData);
  const unitsPerPackage = formData.get("productionUnit") === "UNIT" ? 1 : positiveNumber(formData, "unitsPerPackage", "As unidades por embalagem", 100000);
  if (!Number.isInteger(unitsPerPackage)) throw new Error("As unidades por embalagem devem ser um número inteiro.");
  const productionUnit = text(formData, "productionUnit", 16) || "BAG";
  if (!["BAG","PALLET","UNIT"].includes(productionUnit)) throw new Error("A unidade de produção é inválida.");
  await db.$transaction(async tx => {
  await tx.product.update({ where: { id }, data: {
    code: requireText(text(formData, "code", 40), "O código"),
    name: requireText(text(formData, "name"), "A designação"),
    unitsPerPackage,
    productionUnit,
    active: formData.get("active") === "on",
  }});
  await replaceProductMachines(tx,id,ids);
  await tx.auditLog.create({data:{userId:admin.id,action:"EDIT",entity:"Product",entityId:String(id),details:{machineIds:ids}}});
  });
  revalidatePath("/admin/products"); revalidatePath(`/admin/products/${id}`); revalidatePath("/production");
}

export async function setProductActive(formData: FormData) {
  await requireAdmin();
  const id = positiveId(formData);
  const active = String(formData.get("active")) === "true";
  await db.product.update({ where: { id }, data: { active } });
  revalidatePath("/admin/products"); revalidatePath(`/admin/products/${id}`); revalidatePath("/production");
}

export async function createRawMaterial(formData: FormData) {
  await requireAdmin();
  await db.rawMaterial.create({ data: {
    code: requireText(text(formData, "code", 40), "O código"),
    name: requireText(text(formData, "name"), "A designação"),
    materialType: text(formData, "materialType", 60) || null,
    color: text(formData, "color", 60) || null,
    manufacturer: text(formData, "manufacturer", 120) || null,
    internalReference: text(formData, "internalReference", 80) || null,
    notes: text(formData, "notes", 500) || null,
    unit: "kg", active: true
  } });
  revalidatePath("/admin/raw-materials");
}
export async function updateRawMaterial(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  await db.rawMaterial.update({ where: { id }, data: {
    code: requireText(text(formData, "code", 40), "O código"),
    name: requireText(text(formData, "name"), "A designação"),
    materialType: text(formData, "materialType", 60) || null,
    color: text(formData, "color", 60) || null,
    manufacturer: text(formData, "manufacturer", 120) || null,
    internalReference: text(formData, "internalReference", 80) || null,
    notes: text(formData, "notes", 500) || null,
    active: formData.get("active") === "on", unit: "kg"
  } });
  revalidatePath("/admin/raw-materials"); revalidatePath("/production");
}
export async function createRawMaterialLot(formData: FormData) {
  await requireAdmin();
  const rawMaterialId = Number(formData.get("rawMaterialId"));
  if (!Number.isInteger(rawMaterialId) || rawMaterialId <= 0) throw new Error("Selecione uma matéria-prima.");
  const material = await db.rawMaterial.findFirst({where:{id:rawMaterialId,active:true}});
  if (!material) throw new Error("A matéria-prima não existe ou está inativa.");
  const quantity = positiveNumber(formData, "quantityInitial", "A quantidade");
  await db.rawMaterialLot.create({ data: { rawMaterialId, supplierLot: requireText(text(formData, "supplierLot", 80), "O lote do fornecedor"), supplier: text(formData, "supplier") || null, quantityInitial: quantity, quantityAvailable: quantity } });
  revalidatePath("/admin/raw-materials", "layout"); revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
}

export async function updateRawMaterialLot(formData: FormData) {
  const admin = await requireAdmin();
  const id = positiveId(formData);
  const rawMaterialId = Number(formData.get("rawMaterialId"));
  if (!Number.isInteger(rawMaterialId) || rawMaterialId <= 0) throw new Error("Selecione uma matéria-prima.");
  const quantityInitial = positiveNumber(formData, "quantityInitial", "A quantidade inicial");
  const quantityAvailableValue = Number(formData.get("quantityAvailable"));
  if (!Number.isFinite(quantityAvailableValue) || quantityAvailableValue < 0 || quantityAvailableValue > quantityInitial) throw new Error("A quantidade disponível deve estar entre 0 e a quantidade inicial.");
  const status = text(formData, "status", 20);
  if (!["ACTIVE", "DEPLETED", "CLOSED", "CANCELLED"].includes(status)) throw new Error("Estado do lote inválido.");
  await db.$transaction(async tx => {
    const [current]=await tx.query<any[]>("SELECT * FROM RawMaterialLot WHERE id=? FOR UPDATE",[id]);
    if(!current || Number(current.rawMaterialId)!==rawMaterialId) throw new Error("Este lote não pertence à matéria-prima selecionada.");
    const expected=Number(formData.get("expectedQuantityAvailable"));
    if(!formData.has("expectedQuantityAvailable") || !Number.isFinite(expected) || Math.abs(expected-Number(current.quantityAvailable))>0.00001) throw new Error("A quantidade deste lote mudou entretanto. Atualize a página antes de corrigir o stock.");
    await tx.rawMaterialLot.update({where:{id},data:{supplierLot:requireText(text(formData,"supplierLot",80),"O lote do fornecedor"),supplier:text(formData,"supplier")||null,quantityInitial,quantityAvailable:quantityAvailableValue,status:status as any}});
    await tx.auditLog.create({data:{userId:admin.id,action:"EDIT",entity:"RawMaterialLot",entityId:String(id),details:{before:{quantityInitial:Number(current.quantityInitial),quantityAvailable:Number(current.quantityAvailable),status:current.status},after:{quantityInitial,quantityAvailable:quantityAvailableValue,status}}}});
  });
  revalidatePath("/admin/raw-materials", "layout"); revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
}

export async function createLotRule(formData: FormData) {
  await requireAdmin();
  const data = { name: requireText(text(formData, "name"), "O nome"), prefix: requireText(text(formData, "prefix", 20), "O prefixo"), template: requireText(text(formData, "template", 200), "O modelo"), active: true };
  await db.$transaction(async tx => {
    await tx.query("SELECT id FROM ProductionLotRule ORDER BY id FOR UPDATE");
    await tx.productionLotRule.updateMany({ data: { active: false } });
    await tx.productionLotRule.create({ data });
  });
  revalidatePath("/admin/lot-rules");
}

export async function deleteMachine(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  const [productions, checkups] = await Promise.all([db.production.count({ where: { machineId: id } }), db.machineCheckup.count({ where: { machineId: id } })]);
  if (productions || checkups) await db.machine.update({ where: { id }, data: { active: false } }); else await db.machine.delete({ where: { id } });
  revalidatePath("/admin/machines"); revalidatePath("/production"); revalidatePath("/checkups");
}
export async function deleteProduct(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  if (await db.production.count({ where: { productId: id } })) await db.product.update({ where: { id }, data: { active: false } }); else await db.product.delete({ where: { id } });
  revalidatePath("/admin/products"); revalidatePath("/production");
}
export async function deleteRawMaterial(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  if (await db.rawMaterialLot.count({ where: { rawMaterialId: id } })) await db.rawMaterial.update({ where: { id }, data: { active: false } }); else await db.rawMaterial.delete({ where: { id } });
  revalidatePath("/admin/raw-materials"); revalidatePath("/production");
}
export async function deleteRawMaterialLot(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  if (await db.productionMaterial.count({ where: { rawMaterialLotId: id } })) await db.rawMaterialLot.update({ where: { id }, data: { status: "CANCELLED" } }); else await db.rawMaterialLot.delete({ where: { id } });
  revalidatePath("/admin/raw-materials", "layout"); revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
}
export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin(); const id = positiveId(formData);
  if (id === admin.id) throw new Error("Não pode eliminar o utilizador com sessão iniciada.");
  const deleted = await db.$transaction(async tx => {
    await lockCredentials(tx, admin.id);
    const [current] = await tx.query<any[]>("SELECT id FROM User WHERE id=? FOR UPDATE", [id]);
    if (!current) throw new Error("O utilizador já não existe.");
    await tx.execute("DELETE FROM AuthSession WHERE userId=?", [id]);
    await tx.execute("DELETE FROM ShiftPeerConfirmation WHERE operatorId=? OR confirmedById=?", [id,id]);
    const history = await tx.auditLog.count({where:{userId:id}});
    let removed = false;
    if (!history) {
      try { await tx.user.delete({where:{id}}); removed = true; }
      catch (error) { if ((error as {code?:string}).code !== "ER_ROW_IS_REFERENCED_2") throw error; }
    }
    if (!removed) await tx.execute("UPDATE User SET active=0, sessionVersion=sessionVersion+1, updatedAt=NOW(3) WHERE id=?", [id]);
    await tx.auditLog.create({data:{userId:admin.id,action:removed?"DELETE":"DEACTIVATE",entity:"User",entityId:String(id)}});
    return removed;
  });
  revalidatePath("/admin/users");
  return {message:deleted?"Utilizador eliminado.":"Utilizador desativado e acesso revogado. O histórico foi preservado; pode consultá-lo em Mostrar inativos."};
}
export async function deleteLotRule(formData: FormData) {
  await requireAdmin(); const id = positiveId(formData);
  const rule = await db.productionLotRule.findUniqueOrThrow({ where: { id } });
  if (rule.active) throw new Error("Ative outra regra antes de eliminar a regra atual.");
  await db.productionLotRule.delete({ where: { id } });
  revalidatePath("/admin/lot-rules");
}

// Compatibilidade com referências antigas: registos operacionais nunca são apagados fisicamente.
export async function deleteProduction(formData: FormData) {
  return cancelProduction(formData);
}

export async function deleteMachineCheckup(formData: FormData) {
  const admin = await requireAdmin();
  const id = positiveId(formData);
  await db.$transaction(async (tx) => {
    await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
    const row = await tx.machineCheckup.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new Error("A verificação já não existe.");
    if (row.status === RecordStatus.CANCELLED) throw new Error("A verificação já está cancelada.");
    await tx.machineCheckup.update({ where: { id }, data: { status: RecordStatus.CANCELLED } });
    await tx.auditLog.create({ data: { userId: admin.id, action: "CANCEL", entity: "MachineCheckup", entityId: String(id) } });
  });
  revalidatePath("/admin/checkups"); revalidatePath("/dashboard");
}

export async function deleteGeneralCheckup(formData: FormData) {
  const admin = await requireAdmin();
  const id = positiveId(formData);
  await db.$transaction(async (tx) => {
    await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
    const row = await tx.shiftGeneralCheck.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new Error("A verificação já não existe.");
    if (row.status === RecordStatus.CANCELLED) throw new Error("A verificação já está cancelada.");
    await tx.shiftGeneralCheck.update({ where: { id }, data: { status: RecordStatus.CANCELLED } });
    await tx.auditLog.create({ data: { userId: admin.id, action: "CANCEL", entity: "ShiftGeneralCheck", entityId: String(id) } });
  });
  revalidatePath("/admin/checkups"); revalidatePath("/dashboard");
}
