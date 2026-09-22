// MySQL stores table names differently on Windows (1), macOS (2) and Linux (0).
// Respect the server setting: folding every name would hide real Linux errors.
export function tableNameKey(name, lowerCaseTableNames) {
  return Number(lowerCaseTableNames) === 0 ? String(name) : String(name).toLowerCase();
}

// Column identifiers are case-insensitive on all these configurations.
export function columnKey(table, column, lowerCaseTableNames) {
  return `${tableNameKey(table, lowerCaseTableNames)}.${String(column).toLowerCase()}`;
}
