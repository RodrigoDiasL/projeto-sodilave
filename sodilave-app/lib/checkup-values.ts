export const oilTemperatures = { COLD: "Frio", NORMAL: "Normal", HOT: "Quente", VERY_HOT: "Muito quente" } as const;
export const oilLevels = { LOW: "Baixo", NORMAL: "Normal", HIGH: "Alto" } as const;
export function conditionTone(kind: "temperature" | "level" | "test", value: string) {
  const colors: Record<string, Record<string, string>> = {
    temperature: { COLD: "blue", NORMAL: "green", HOT: "yellow", VERY_HOT: "orange" },
    level: { LOW: "red", NORMAL: "green", HIGH: "green" },
    test: { CONFORMING: "green", NON_CONFORMING: "red", NOT_PERFORMED: "orange" },
  };
  return colors[kind][value] ? `condition-${colors[kind][value]}` : "";
}
export function pressureTone(value: string, min: number, max: number) {
  if (!value.trim()) return "";
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? "condition-green" : "condition-red";
}
export function oilTemperatureLabel(record: { oilTempStatus?: string | null; oilTempC?: unknown }) {
  return oilTemperatures[record.oilTempStatus as keyof typeof oilTemperatures]
    ?? (record.oilTempC == null ? "—" : `${record.oilTempC} °C (registo anterior)`);
}
