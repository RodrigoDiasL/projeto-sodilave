"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertPinAvailable, assertValidPin } from "@/lib/pin-policy";
import { cancelProduction } from "@/app/actions/production-admin";
import { RecordStatus, UserRole } from "@/lib/db-types";

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
async function replaceProductMachines(productId:number, ids:number[]){
  const valid = await db.machine.findMany({where:{id:{in:ids},active:true},select:{id:true}});
  if(valid.length!==ids.length) throw new Error("Uma das máquinas selecionadas é inválida ou está inativa.");
  await db.$transaction(async tx=>{
    await tx.$executeRaw`DELETE FROM ProductMachine WHERE productId=${productId}`;
    for(const machineId of ids) await tx.$executeRaw`INSERT INTO ProductMachine (productId,machineId) VALUES (${productId},${machineId})`;
  });
}

export async function createUser(formData: FormData) {
  const admin = await requireAdmin();
  const name = requireText(text(formData, "name"), "O nome");
  const pin = text(formData, "pin", 8);
  const role = text(formData, "role", 20) as UserRole;
  assertValidPin(pin);
  await assertPinAvailable(pin);
  if (!Object.values(UserRole).includes(role)) throw new Error("Perfil inválido.");
  const row = await db.user.create({ data: { name, pinHash: await bcrypt.hash(pin, 12), role, active: true } });
  await db.auditLog.create({ data: { userId: admin.id, action: "CREATE", entity: "User", entityId: String(row.id) } });
  revalidatePath("/admin/users");
}

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = positiveId(formData);
  const name = requireText(text(formData, "name"), "O nome");
  const pin = text(formData, "pin", 8);
  const role = text(formData, "role", 20) as UserRole;
  const active = formData.get("active") === "on";
  if (!Object.values(UserRole).includes(role)) throw new Error("Perfil inválido.");
  if (pin) {
    assertValidPin(pin, "O novo PIN");
    await assertPinAvailable(pin, id);
  }
  if (id === admin.id && (!active || role !== UserRole.ADMIN)) throw new Error("Não pode retirar o seu próprio acesso de administrador nem desativar a conta com sessão iniciada.");
  const data: { name: string; role: UserRole; active: boolean; pinHash?: string } = { name, role, active };
  if (pin) data.pinHash = await bcrypt.hash(pin, 12);
  await db.user.update({ where: { id }, data });
  await db.auditLog.create({ data: { userId: admin.id, action: "EDIT", entity: "User", entityId: String(id), details: { name, role, active, pinChanged: Boolean(pin) } } });
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
  const unitsPerPackage = positiveNumber(formData, "unitsPerPackage", "As unidades por embalagem", 100000);
  const row=await db.product.create({ data: { code: requireText(text(formData, "code", 40), "O código"), name: requireText(text(formData, "name"), "A designação"), unitsPerPackage, active: true } });
  await replaceProductMachines(row.id,ids);
  await db.auditLog.create({data:{userId:admin.id,action:"CREATE",entity:"Product",entityId:String(row.id),details:{machineIds:ids}}});
  revalidatePath("/admin/products"); revalidatePath("/production");
}

export async function updateProduct(formData: FormData) {
  const admin=await requireAdmin();
  const id = positiveId(formData);
  const ids=machineIds(formData);
  const unitsPerPackage = positiveNumber(formData, "unitsPerPackage", "As unidades por embalagem", 100000);
  await db.product.update({ where: { id }, data: {
    code: requireText(text(formData, "code", 40), "O código"),
    name: requireText(text(formData, "name"), "A designação"),
    unitsPerPackage,
    active: formData.get("active") === "on",
  }});
  await replaceProductMachines(id,ids);
  await db.auditLog.create({data:{userId:admin.id,action:"EDIT",entity:"Product",entityId:String(id),details:{machineIds:ids}}});
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
  const quantity = positiveNumber(formData, "quantityInitial", "A quantidade");
  await db.rawMaterialLot.create({ data: { rawMaterialId, supplierLot: requireText(text(formData, "supplierLot", 80), "O lote do fornecedor"), supplier: text(formData, "supplier") || null, quantityInitial: quantity, quantityAvailable: quantity } });
  revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
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
  await db.rawMaterialLot.update({ where: { id }, data: {
    rawMaterialId,
    supplierLot: requireText(text(formData, "supplierLot", 80), "O lote do fornecedor"),
    supplier: text(formData, "supplier") || null,
    quantityInitial,
    quantityAvailable: quantityAvailableValue,
    status: status as any,
  } });
  await db.auditLog.create({ data: { userId: admin.id, action: "EDIT", entity: "RawMaterialLot", entityId: String(id) } });
  revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
}

export async function createLotRule(formData: FormData) {
  await requireAdmin();
  await db.productionLotRule.updateMany({ data: { active: false } });
  await db.productionLotRule.create({ data: { name: requireText(text(formData, "name"), "O nome"), prefix: requireText(text(formData, "prefix", 20), "O prefixo"), template: requireText(text(formData, "template", 200), "O modelo"), active: true } });
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
  revalidatePath("/admin/raw-material-lots"); revalidatePath("/production");
}
export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin(); const id = positiveId(formData);
  if (id === admin.id) throw new Error("Não pode eliminar o utilizador com sessão iniciada.");
  const references = await Promise.all([db.production.count({ where: { operatorId: id } }), db.machineCheckup.count({ where: { operatorId: id } }), db.shiftGeneralCheck.count({ where: { operatorId: id } })]);
  if (references.some(Boolean)) await db.user.update({ where: { id }, data: { active: false } }); else await db.user.delete({ where: { id } });
  revalidatePath("/admin/users");
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
    const row = await tx.shiftGeneralCheck.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new Error("A verificação já não existe.");
    if (row.status === RecordStatus.CANCELLED) throw new Error("A verificação já está cancelada.");
    await tx.shiftGeneralCheck.update({ where: { id }, data: { status: RecordStatus.CANCELLED } });
    await tx.auditLog.create({ data: { userId: admin.id, action: "CANCEL", entity: "ShiftGeneralCheck", entityId: String(id) } });
  });
  revalidatePath("/admin/checkups"); revalidatePath("/dashboard");
}
