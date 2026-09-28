export type ShiftCode = "A" | "B" | "C";

export function getShift(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 0 && hour < 8) return { code: "A" as ShiftCode, label: "Turno A", hours: "00:00 - 08:00" };
  if (hour >= 8 && hour < 16) return { code: "B" as ShiftCode, label: "Turno B", hours: "08:00 - 16:00" };
  return { code: "C" as ShiftCode, label: "Turno C", hours: "16:00 - 24:00" };
}

export function getShiftWindow(date = new Date()) {
  const shift = getShift(date);
  const start = new Date(date);
  const end = new Date(date);
  start.setMinutes(0, 0, 0);
  end.setMinutes(0, 0, 0);
  if (shift.code === "A") { start.setHours(0); end.setHours(8); }
  else if (shift.code === "B") { start.setHours(8); end.setHours(16); }
  else { start.setHours(16); end.setDate(end.getDate() + 1); end.setHours(0); }
  return { ...shift, start, end };
}

export function getShiftWindowForDate(dateText: string, shiftCode: ShiftCode) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error("A data selecionada é inválida.");
  if (!["A", "B", "C"].includes(shiftCode)) throw new Error("O turno selecionado é inválido.");
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) throw new Error("A data selecionada é inválida.");

  if (shiftCode === "A") date.setHours(0, 0, 0, 0);
  else if (shiftCode === "B") date.setHours(8, 0, 0, 0);
  else date.setHours(16, 0, 0, 0);

  const start = new Date(date);
  const end = new Date(date);
  end.setHours(end.getHours() + 8);
  const hours = shiftCode === "A" ? "00:00 - 08:00" : shiftCode === "B" ? "08:00 - 16:00" : "16:00 - 24:00";
  return { code: shiftCode, label: `Turno ${shiftCode}`, hours, start, end };
}

export function formatLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const productionGraceMs = 30 * 60 * 1000;
export function productionEditDeadline(date:Date){return new Date(getShiftWindow(date).end.getTime()+productionGraceMs);}
// During handover, new closing records default to the shift that just ended.
export function getProductionEntryWindow(now=new Date()){
  const current=getShiftWindow(now);
  return now.getTime()-current.start.getTime()<=productionGraceMs
    ? getShiftWindow(new Date(current.start.getTime()-1)) : current;
}
