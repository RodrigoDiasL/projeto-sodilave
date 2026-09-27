export function productionUnitLabel(unit: string | null | undefined, quantity = 2) {
  if (unit === "UNIT") return quantity === 1 ? "unidade" : "unidades";
  if (unit === "PALLET") return quantity === 1 ? "palete" : "paletes";
  return quantity === 1 ? "saco" : "sacos";
}
