import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";

type SqlClient = Pool | PoolConnection;
type QueryArgs = {
  where?: Record<string, any>;
  orderBy?: any;
  take?: number;
  select?: Record<string, any>;
  include?: Record<string, any>;
};
type SqlPart = { sql: string; params: any[] };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatório.");

function createPoolFromUrl(urlText: string) {
  const url = new URL(urlText);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL deve usar mysql://.");
  return mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: "Z",
    charset: "utf8mb4",
  });
}

const globalForMysql = globalThis as typeof globalThis & { sodilaveMysqlPool?: Pool };
const pool = globalForMysql.sodilaveMysqlPool ?? createPoolFromUrl(databaseUrl);
if (process.env.NODE_ENV !== "production") globalForMysql.sodilaveMysqlPool = pool;

const ident = (name: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Identificador SQL inválido: ${name}`);
  return `\`${name}\``;
};

const sqlValue = (value: any) => typeof value === "boolean" ? (value ? 1 : 0) : value;

async function queryRows<T = any>(client: SqlClient, sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await client.query(sql, params.map(sqlValue));
  return rows as T[];
}

async function executeSql(client: SqlClient, sql: string, params: any[] = []) {
  const [result] = await client.execute<ResultSetHeader>(sql, params.map(sqlValue));
  return result;
}

function listPlaceholders(values: readonly any[]) {
  return values.map(() => "?").join(",");
}

function buildWhere(where?: Record<string, any>, alias = "t"): SqlPart {
  if (!where || Object.keys(where).length === 0) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: any[] = [];
  const col = (key: string) => `${alias}.${ident(key)}`;

  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      const branches = (value as any[]).map((branch) => buildWhere(branch, alias)).filter((branch) => branch.sql);
      if (branches.length) {
        parts.push(`(${branches.map((branch) => branch.sql.replace(/^ WHERE /, "")).join(" OR ")})`);
        for (const branch of branches) params.push(...branch.params);
      }
      continue;
    }
    if (value === undefined) continue;
    if (value === null) {
      parts.push(`${col(key)} IS NULL`);
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if ("in" in value) {
        const values = Array.from(value.in ?? []);
        if (!values.length) parts.push("1=0");
        else {
          parts.push(`${col(key)} IN (${listPlaceholders(values)})`);
          params.push(...values);
        }
      }
      if ("not" in value) {
        if (value.not === null) parts.push(`${col(key)} IS NOT NULL`);
        else {
          parts.push(`${col(key)} <> ?`);
          params.push(value.not);
        }
      }
      if ("gte" in value) { parts.push(`${col(key)} >= ?`); params.push(value.gte); }
      if ("gt" in value) { parts.push(`${col(key)} > ?`); params.push(value.gt); }
      if ("lte" in value) { parts.push(`${col(key)} <= ?`); params.push(value.lte); }
      if ("lt" in value) { parts.push(`${col(key)} < ?`); params.push(value.lt); }
      if ("contains" in value) { parts.push(`${col(key)} LIKE ?`); params.push(`%${value.contains}%`); }
      continue;
    }
    parts.push(`${col(key)} = ?`);
    params.push(value);
  }
  return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
}

function buildOrder(orderBy: any, alias = "t") {
  if (!orderBy) return "";
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts: string[] = [];
  for (const item of items) {
    for (const [key, direction] of Object.entries(item)) {
      if (typeof direction === "string") parts.push(`${alias}.${ident(key)} ${String(direction).toUpperCase() === "DESC" ? "DESC" : "ASC"}`);
    }
  }
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

function projectRow(row: any, select?: Record<string, any>) {
  if (!select) return row;
  const out: any = {};
  for (const [key, rule] of Object.entries(select)) {
    if (!rule) continue;
    if (rule === true) out[key] = row[key];
    else if (typeof rule === "object" && "select" in rule) {
      if (Array.isArray(row[key])) out[key] = row[key].map((item: any) => projectRow(item, rule.select));
      else if (row[key] != null) out[key] = projectRow(row[key], rule.select);
      else out[key] = row[key];
    }
  }
  return out;
}

function projectRows(rows: any[], select?: Record<string, any>) {
  return select ? rows.map((row) => projectRow(row, select)) : rows;
}

async function getByIds(client: SqlClient, table: string, ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (!unique.length) return new Map<number, any>();
  const rows = await queryRows<any>(client, `SELECT * FROM ${ident(table)} WHERE id IN (${listPlaceholders(unique)})`, unique);
  return new Map(rows.map((row) => [Number(row.id), row]));
}

function prepareData(table: string, data: Record<string, any>) {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (table === "AuditLog" && key === "details" && value !== null && typeof value === "object") result[key] = JSON.stringify(value);
    else result[key] = sqlValue(value);
  }
  return result;
}

async function insertRow(client: SqlClient, table: string, data: Record<string, any>) {
  const clean = prepareData(table, data);
  const keys = Object.keys(clean);
  if (!keys.length) throw new Error(`Não existem dados para inserir em ${table}.`);
  const result = await executeSql(
    client,
    `INSERT INTO ${ident(table)} (${keys.map(ident).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    keys.map((key) => clean[key]),
  );
  const id = Number(result.insertId);
  return id ? (await queryRows<any>(client, `SELECT * FROM ${ident(table)} WHERE id=? LIMIT 1`, [id]))[0] : { ...clean };
}

async function updateRows(client: SqlClient, table: string, where: Record<string, any>, data: Record<string, any>) {
  const clean = prepareData(table, data);
  const keys = Object.keys(clean);
  if (!keys.length) return { count: 0 };
  const condition = buildWhere(where);
  const result = await executeSql(
    client,
    `UPDATE ${ident(table)} t SET ${keys.map((key) => `${ident(key)}=?`).join(",")}${condition.sql}`,
    [...keys.map((key) => clean[key]), ...condition.params],
  );
  return { count: result.affectedRows };
}

async function deleteRows(client: SqlClient, table: string, where: Record<string, any>) {
  const condition = buildWhere(where);
  const result = await executeSql(client, `DELETE FROM ${ident(table)}${condition.sql.replaceAll("t.", "")}`, condition.params);
  return { count: result.affectedRows };
}

function simpleRepo(client: SqlClient, table: string) {
  const api = {
    async findMany(args: QueryArgs = {}) {
      const condition = buildWhere(args.where);
      const rows = await queryRows<any>(
        client,
        `SELECT t.* FROM ${ident(table)} t${condition.sql}${buildOrder(args.orderBy)}${args.take ? ` LIMIT ${Number(args.take)}` : ""}`,
        condition.params,
      );
      return projectRows(rows, args.select);
    },
    async findFirst(args: QueryArgs = {}) {
      const rows = await api.findMany({ ...args, take: 1 });
      return rows[0] ?? null;
    },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) {
      return api.findFirst(args);
    },
    async findUniqueOrThrow(args: QueryArgs & { where: Record<string, any> }) {
      const row = await api.findUnique(args);
      if (!row) throw new Error(`${table} não encontrado.`);
      return row;
    },
    async count(args: { where?: Record<string, any> } = {}) {
      const condition = buildWhere(args.where);
      const rows = await queryRows<{ count: number | string }>(client, `SELECT COUNT(*) count FROM ${ident(table)} t${condition.sql}`, condition.params);
      return Number(rows[0]?.count ?? 0);
    },
    async create(args: { data: Record<string, any> }) {
      return insertRow(client, table, args.data);
    },
    async update(args: { where: Record<string, any>; data: Record<string, any> }) {
      await updateRows(client, table, args.where, args.data);
      const row = await api.findUnique({ where: args.where });
      if (!row) throw new Error(`${table} não encontrado após atualização.`);
      return row;
    },
    async updateMany(args: { where?: Record<string, any>; data: Record<string, any> }) {
      return updateRows(client, table, args.where ?? {}, args.data);
    },
    async delete(args: { where: Record<string, any> }) {
      const existing = await api.findUnique({ where: args.where });
      if (!existing) throw new Error(`${table} não encontrado.`);
      await deleteRows(client, table, args.where);
      return existing;
    },
    async deleteMany(args: { where?: Record<string, any> } = {}) {
      return deleteRows(client, table, args.where ?? {});
    },
    async createMany(args: { data: Record<string, any>[] }) {
      for (const row of args.data) await insertRow(client, table, row);
      return { count: args.data.length };
    },
  };
  return api;
}

async function attachSimpleRelations(client: SqlClient, rows: any[], include?: Record<string, any>) {
  if (!include || !rows.length) return rows;
  if (include.machine) {
    const map = await getByIds(client, "Machine", rows.map((row) => row.machineId));
    for (const row of rows) row.machine = map.get(Number(row.machineId)) ?? null;
  }
  if (include.product) {
    const map = await getByIds(client, "Product", rows.map((row) => row.productId));
    for (const row of rows) row.product = map.get(Number(row.productId)) ?? null;
  }
  if (include.operator) {
    const map = await getByIds(client, "User", rows.map((row) => row.operatorId));
    for (const row of rows) row.operator = map.get(Number(row.operatorId)) ?? null;
  }
  if (include.user) {
    const map = await getByIds(client, "User", rows.map((row) => row.userId).filter(Boolean));
    for (const row of rows) row.user = row.userId ? map.get(Number(row.userId)) ?? null : null;
  }
  if (include.createdBy) {
    const map = await getByIds(client, "User", rows.map((row) => row.createdById).filter(Boolean));
    for (const row of rows) row.createdBy = row.createdById ? map.get(Number(row.createdById)) ?? null : null;
  }
  return rows;
}

function productionRepo(client: SqlClient) {
  const base = simpleRepo(client, "Production");

  async function findMany(args: QueryArgs = {}) {
    const where = { ...(args.where ?? {}) };
    const or = Array.isArray(where.OR) ? where.OR : null;
    delete where.OR;
    const condition = buildWhere(where);
    const params = [...condition.params];
    let sql = `SELECT t.* FROM Production t${condition.sql}`;

    if (or?.length) {
      const clauses: string[] = [];
      for (const branch of or) {
        if (branch.id?.in) {
          const ids = Array.from(branch.id.in);
          if (ids.length) { clauses.push(`t.id IN (${listPlaceholders(ids)})`); params.push(...ids); }
        } else if (branch.productionLot?.contains != null) {
          clauses.push("t.productionLot LIKE ?");
          params.push(`%${branch.productionLot.contains}%`);
        } else if (branch.product?.name?.contains != null) {
          clauses.push("EXISTS (SELECT 1 FROM Product p WHERE p.id=t.productId AND p.name LIKE ?)");
          params.push(`%${branch.product.name.contains}%`);
        } else if (branch.machine?.code?.contains != null) {
          clauses.push("EXISTS (SELECT 1 FROM Machine m WHERE m.id=t.machineId AND m.code LIKE ?)");
          params.push(`%${branch.machine.code.contains}%`);
        }
      }
      if (clauses.length) sql += `${condition.sql ? " AND " : " WHERE "}(${clauses.join(" OR ")})`;
    }

    const orderItems = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
    const orderParts: string[] = [];
    for (const item of orderItems) {
      for (const [key, direction] of Object.entries(item)) {
        if (key === "machine" && typeof direction === "object" && (direction as any).code) {
          orderParts.push(`(SELECT code FROM Machine m WHERE m.id=t.machineId) ${String((direction as any).code).toUpperCase() === "DESC" ? "DESC" : "ASC"}`);
        } else if (typeof direction === "string") {
          orderParts.push(`t.${ident(key)} ${direction.toUpperCase() === "DESC" ? "DESC" : "ASC"}`);
        }
      }
    }
    if (orderParts.length) sql += ` ORDER BY ${orderParts.join(",")}`;
    if (args.take) sql += ` LIMIT ${Number(args.take)}`;

    const rows = await queryRows<any>(client, sql, params);
    const relationRequest: Record<string, any> = { ...(args.include ?? {}) };
    if (args.select?.machine) relationRequest.machine = args.select.machine;
    if (args.select?.product) relationRequest.product = args.select.product;
    if (args.select?.operator) relationRequest.operator = args.select.operator;
    if (args.select?.tests) relationRequest.tests = args.select.tests;
    if (args.select?.materials) relationRequest.materials = args.select.materials;

    await attachSimpleRelations(client, rows, relationRequest);

    if (relationRequest.materials) {
      const productionIds = rows.map((row) => Number(row.id));
      const materials = productionIds.length
        ? await queryRows<any>(client, `SELECT * FROM ProductionMaterial WHERE productionId IN (${listPlaceholders(productionIds)}) ORDER BY id ASC`, productionIds)
        : [];
      const materialInclude = relationRequest.materials === true ? undefined : relationRequest.materials.include;
      if (materialInclude?.rawMaterialLot) {
        const lotMap = await getByIds(client, "RawMaterialLot", materials.map((row) => row.rawMaterialLotId));
        const lots = [...lotMap.values()];
        const wantsRawMaterial = materialInclude.rawMaterialLot === true ? false : Boolean(materialInclude.rawMaterialLot.include?.rawMaterial);
        if (wantsRawMaterial) {
          const rawMap = await getByIds(client, "RawMaterial", lots.map((row: any) => row.rawMaterialId));
          for (const lot of lots) lot.rawMaterial = rawMap.get(Number(lot.rawMaterialId)) ?? null;
        }
        for (const material of materials) material.rawMaterialLot = lotMap.get(Number(material.rawMaterialLotId)) ?? null;
      }
      for (const row of rows) row.materials = materials.filter((material) => Number(material.productionId) === Number(row.id));
    }

    if (relationRequest.tests) {
      const ids = rows.map((row) => Number(row.id));
      const tests = ids.length ? await queryRows<any>(client, `SELECT * FROM QualityTest WHERE productionId IN (${listPlaceholders(ids)}) ORDER BY id ASC`, ids) : [];
      for (const row of rows) row.tests = tests.filter((test) => Number(test.productionId) === Number(row.id));
    }

    return projectRows(rows, args.select);
  }

  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUniqueOrThrow(args: QueryArgs & { where: Record<string, any> }) {
      const row = (await findMany({ ...args, take: 1 }))[0];
      if (!row) throw new Error("Production não encontrada.");
      return row;
    },
  };
}

function rawMaterialLotRepo(client: SqlClient) {
  const base = simpleRepo(client, "RawMaterialLot");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    if (args.include?.rawMaterial) {
      const map = await getByIds(client, "RawMaterial", rows.map((row: any) => row.rawMaterialId));
      for (const row of rows) row.rawMaterial = map.get(Number(row.rawMaterialId)) ?? null;
    }
    return projectRows(rows, args.select);
  }
  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
  };
}

function machineCheckupRepo(client: SqlClient) {
  const base = simpleRepo(client, "MachineCheckup");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    await attachSimpleRelations(client, rows, args.include);
    return projectRows(rows, args.select);
  }
  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
  };
}

function shiftGeneralCheckRepo(client: SqlClient) {
  const base = simpleRepo(client, "ShiftGeneralCheck");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    await attachSimpleRelations(client, rows, args.include);
    return projectRows(rows, args.select);
  }
  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
  };
}

function auditLogRepo(client: SqlClient) {
  const base = simpleRepo(client, "AuditLog");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    await attachSimpleRelations(client, rows, args.include);
    return projectRows(rows, args.select);
  }
  return { ...base, findMany };
}

function productRepo(client: SqlClient) {
  const base = simpleRepo(client, "Product");
  async function findUnique(args: QueryArgs & { where: Record<string, any> }) {
    const row = await base.findUnique({ ...args, include: undefined, select: undefined });
    if (!row) return null;
    if (args.include?._count?.select?.productions) {
      row._count = { productions: await simpleRepo(client, "Production").count({ where: { productId: row.id } }) };
    }
    return projectRow(row, args.select);
  }
  return { ...base, findUnique };
}

function weeklyStartupRepo(client: SqlClient) {
  const base = simpleRepo(client, "WeeklyStartup");

  async function findMany(args: QueryArgs = {}) {
    const where = { ...(args.where ?? {}) };
    const requireNoShutdown = Object.prototype.hasOwnProperty.call(where, "shutdown") && where.shutdown === null;
    delete where.shutdown;
    const condition = buildWhere(where);
    let sql = `SELECT t.* FROM WeeklyStartup t${condition.sql}`;
    const params = [...condition.params];
    if (requireNoShutdown) sql += `${condition.sql ? " AND " : " WHERE "}NOT EXISTS (SELECT 1 FROM WeeklyShutdown ws WHERE ws.weeklyStartupId=t.id)`;
    sql += buildOrder(args.orderBy);
    if (args.take) sql += ` LIMIT ${Number(args.take)}`;
    const rows = await queryRows<any>(client, sql, params);

    if (args.include?.operator) {
      const map = await getByIds(client, "User", rows.map((row) => row.operatorId));
      for (const row of rows) row.operator = map.get(Number(row.operatorId)) ?? null;
    }
    if (args.include?.shutdown) {
      const ids = rows.map((row) => Number(row.id));
      const shutdowns = ids.length ? await queryRows<any>(client, `SELECT * FROM WeeklyShutdown WHERE weeklyStartupId IN (${listPlaceholders(ids)})`, ids) : [];
      for (const row of rows) row.shutdown = shutdowns.find((item) => Number(item.weeklyStartupId) === Number(row.id)) ?? null;
    }
    if (args.include?.machines) {
      const ids = rows.map((row) => Number(row.id));
      const machines = ids.length ? await queryRows<any>(client, `SELECT * FROM WeeklyStartupMachine WHERE weeklyStartupId IN (${listPlaceholders(ids)}) ORDER BY id ASC`, ids) : [];
      const machineRule = args.include.machines;
      if (machineRule !== true && machineRule.include?.machine) {
        const map = await getByIds(client, "Machine", machines.map((item) => item.machineId));
        for (const item of machines) item.machine = map.get(Number(item.machineId)) ?? null;
      }
      for (const row of rows) row.machines = machines.filter((item) => Number(item.weeklyStartupId) === Number(row.id)).map((item) => machineRule?.select ? projectRow(item, machineRule.select) : item);
    }
    return projectRows(rows, args.select);
  }

  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
  };
}

function weeklyShutdownRepo(client: SqlClient) {
  const base = simpleRepo(client, "WeeklyShutdown");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    if (args.include?.operator) {
      const map = await getByIds(client, "User", rows.map((row: any) => row.operatorId));
      for (const row of rows) row.operator = map.get(Number(row.operatorId)) ?? null;
    }
    if (args.include?.weeklyStartup) {
      const map = await getByIds(client, "WeeklyStartup", rows.map((row: any) => row.weeklyStartupId));
      for (const row of rows) row.weeklyStartup = map.get(Number(row.weeklyStartupId)) ?? null;
    }
    if (args.include?.machines) {
      const ids = rows.map((row: any) => Number(row.id));
      const machines = ids.length ? await queryRows<any>(client, `SELECT * FROM WeeklyShutdownMachine WHERE weeklyShutdownId IN (${listPlaceholders(ids)}) ORDER BY id ASC`, ids) : [];
      if (args.include.machines !== true && args.include.machines.include?.machine) {
        const map = await getByIds(client, "Machine", machines.map((item) => item.machineId));
        for (const item of machines) item.machine = map.get(Number(item.machineId)) ?? null;
      }
      for (const row of rows) row.machines = machines.filter((item) => Number(item.weeklyShutdownId) === Number(row.id));
    }
    return projectRows(rows, args.select);
  }
  return {
    ...base,
    findMany,
    async findFirst(args: QueryArgs = {}) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
  };
}

function maintenanceRepo(client: SqlClient) {
  const base = simpleRepo(client, "Maintenance");

  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    if (args.include?.createdBy) {
      const map = await getByIds(client, "User", rows.map((row: any) => row.createdById));
      for (const row of rows) row.createdBy = map.get(Number(row.createdById)) ?? null;
    }
    if (args.include?.machines) {
      const ids = rows.map((row: any) => Number(row.id));
      const links = ids.length ? await queryRows<any>(client, `SELECT * FROM MaintenanceMachine WHERE maintenanceId IN (${listPlaceholders(ids)})`, ids) : [];
      if (args.include.machines !== true && args.include.machines.include?.machine) {
        const map = await getByIds(client, "Machine", links.map((link) => link.machineId));
        for (const link of links) link.machine = map.get(Number(link.machineId)) ?? null;
      }
      for (const row of rows) row.machines = links.filter((link) => Number(link.maintenanceId) === Number(row.id));
    }
    if (args.include?.participants) {
      const ids = rows.map((row: any) => Number(row.id));
      const links = ids.length ? await queryRows<any>(client, `SELECT * FROM MaintenanceParticipant WHERE maintenanceId IN (${listPlaceholders(ids)})`, ids) : [];
      if (args.include.participants !== true && args.include.participants.include?.user) {
        const map = await getByIds(client, "User", links.map((link) => link.userId));
        for (const link of links) link.user = map.get(Number(link.userId)) ?? null;
      }
      for (const row of rows) row.participants = links.filter((link) => Number(link.maintenanceId) === Number(row.id));
    }
    return projectRows(rows, args.select);
  }

  async function create(args: { data: Record<string, any> }) {
    const { machines, participants, ...data } = args.data;
    const row = await insertRow(client, "Maintenance", data);
    const machineRows = machines?.create ? (Array.isArray(machines.create) ? machines.create : [machines.create]) : [];
    const participantRows = participants?.create ? (Array.isArray(participants.create) ? participants.create : [participants.create]) : [];
    for (const item of machineRows) await insertRow(client, "MaintenanceMachine", { maintenanceId: row.id, ...item });
    for (const item of participantRows) await insertRow(client, "MaintenanceParticipant", { maintenanceId: row.id, ...item });
    return row;
  }

  return {
    ...base,
    findMany,
    async findUnique(args: QueryArgs & { where: Record<string, any> }) { return (await findMany({ ...args, take: 1 }))[0] ?? null; },
    async findUniqueOrThrow(args: QueryArgs & { where: Record<string, any> }) {
      const row = (await findMany({ ...args, take: 1 }))[0];
      if (!row) throw new Error("Maintenance não encontrada.");
      return row;
    },
    create,
  };
}

function incidentRepo(client: SqlClient) {
  const base = simpleRepo(client, "Incident");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    await attachSimpleRelations(client, rows, args.include);
    if (args.include?.maintenance) {
      const ids = rows.map((row: any) => Number(row.id));
      const maintenance = ids.length ? await queryRows<any>(client, `SELECT * FROM Maintenance WHERE incidentId IN (${listPlaceholders(ids)})`, ids) : [];
      for (const row of rows) row.maintenance = maintenance.find((item) => Number(item.incidentId) === Number(row.id)) ?? null;
    }
    return projectRows(rows, args.select);
  }
  return { ...base, findMany };
}

function machineEventRepo(client: SqlClient) {
  const base = simpleRepo(client, "MachineEvent");
  async function findMany(args: QueryArgs = {}) {
    const rows = await base.findMany({ ...args, include: undefined, select: undefined });
    await attachSimpleRelations(client, rows, args.include);
    return projectRows(rows, args.select);
  }
  return { ...base, findMany };
}

function machineRepo(client: SqlClient) {
  const base = simpleRepo(client, "Machine");
  async function findUnique(args: QueryArgs & { where: Record<string, any> }) {
    const row = await base.findUnique({ ...args, include: undefined, select: undefined });
    if (!row) return null;
    const include = args.include ?? {};
    if (include.events) {
      const eventArgs = include.events === true ? {} : include.events;
      row.events = await machineEventRepo(client).findMany({ where: { machineId: row.id }, include: eventArgs.include, orderBy: eventArgs.orderBy, take: eventArgs.take });
    }
    if (include.incidents) {
      const incidentArgs = include.incidents === true ? {} : include.incidents;
      row.incidents = await incidentRepo(client).findMany({ where: { machineId: row.id }, include: incidentArgs.include, orderBy: incidentArgs.orderBy, take: incidentArgs.take });
    }
    if (include.maintenanceMachines) {
      const links = await queryRows<any>(client, "SELECT * FROM MaintenanceMachine WHERE machineId=?", [row.id]);
      const maintenanceIds = links.map((link) => Number(link.maintenanceId));
      const maintenances = maintenanceIds.length ? await maintenanceRepo(client).findMany({ where: { id: { in: maintenanceIds } }, include: include.maintenanceMachines.include?.maintenance?.include ? { createdBy: true } : undefined, orderBy: include.maintenanceMachines.orderBy?.maintenance?.performedAt ? { performedAt: include.maintenanceMachines.orderBy.maintenance.performedAt } : undefined }) : [];
      const map = new Map(maintenances.map((item: any) => [Number(item.id), item]));
      for (const link of links) link.maintenance = map.get(Number(link.maintenanceId)) ?? null;
      if (include.maintenanceMachines.orderBy?.maintenance?.performedAt) {
        const dir = String(include.maintenanceMachines.orderBy.maintenance.performedAt).toLowerCase();
        links.sort((a, b) => {
          const av = a.maintenance?.performedAt?.getTime?.() ?? 0;
          const bv = b.maintenance?.performedAt?.getTime?.() ?? 0;
          return dir === "desc" ? bv - av : av - bv;
        });
      }
      row.maintenanceMachines = links;
    }
    return projectRow(row, args.select);
  }
  return { ...base, findUnique };
}

function createDb(client: SqlClient) {
  const dbObject: any = {
    user: simpleRepo(client, "User"),
    machine: machineRepo(client),
    product: productRepo(client),
    rawMaterial: simpleRepo(client, "RawMaterial"),
    rawMaterialLot: rawMaterialLotRepo(client),
    productionLotRule: simpleRepo(client, "ProductionLotRule"),
    production: productionRepo(client),
    productionMaterial: simpleRepo(client, "ProductionMaterial"),
    qualityTest: simpleRepo(client, "QualityTest"),
    machineCheckup: machineCheckupRepo(client),
    shiftGeneralCheck: shiftGeneralCheckRepo(client),
    auditLog: auditLogRepo(client),
    weeklyStartup: weeklyStartupRepo(client),
    weeklyStartupMachine: simpleRepo(client, "WeeklyStartupMachine"),
    weeklyShutdown: weeklyShutdownRepo(client),
    weeklyShutdownMachine: simpleRepo(client, "WeeklyShutdownMachine"),
    maintenance: maintenanceRepo(client),
    maintenanceMachine: simpleRepo(client, "MaintenanceMachine"),
    maintenanceParticipant: simpleRepo(client, "MaintenanceParticipant"),
    incident: incidentRepo(client),
    machineEvent: machineEventRepo(client),

    async query<T = any[]>(sql: string, params: any[] = []): Promise<T> {
      return await queryRows<any>(client, sql, params) as T;
    },

    async execute(sql: string, params: any[] = []) {
      const result = await executeSql(client, sql, params);
      return result.affectedRows;
    },

    async $queryRaw<T = any[]>(strings: TemplateStringsArray, ...values: any[]): Promise<T> {
      let sql = strings[0];
      const params: any[] = [];
      for (let i = 0; i < values.length; i++) {
        sql += "?" + strings[i + 1];
        params.push(values[i]);
      }
      return await queryRows<any>(client, sql, params) as T;
    },

    async $queryRawUnsafe<T = any[]>(sql: string, ...params: any[]): Promise<T> {
      return await queryRows<any>(client, sql, params) as T;
    },

    async $executeRaw(strings: TemplateStringsArray, ...values: any[]) {
      let sql = strings[0];
      const params: any[] = [];
      for (let i = 0; i < values.length; i++) {
        sql += "?" + strings[i + 1];
        params.push(values[i]);
      }
      const result = await executeSql(client, sql, params);
      return result.affectedRows;
    },

    async $executeRawUnsafe(sql: string, ...params: any[]) {
      const result = await executeSql(client, sql, params);
      return result.affectedRows;
    },

    async $transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
      if ("beginTransaction" in client && client !== pool) return fn(dbObject);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await fn(createDb(connection));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
  return dbObject;
}

export type DbTransaction = ReturnType<typeof createDb>;
export const db = createDb(pool);
