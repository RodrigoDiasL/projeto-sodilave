export function productionUnitLabel(unit: string | null | undefined, quantity = 2) {
  if (unit === "BOX") return quantity === 1 ? "caixa" : "caixas";
  if (unit === "BIN") return quantity === 1 ? "caixote" : "caixotes";
  if (unit === "UNIT") return quantity === 1 ? "unidade" : "unidades";
  if (unit === "PALLET") return quantity === 1 ? "palete" : "paletes";
  return quantity === 1 ? "saco" : "sacos";
}
