export function getShift(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 0 && hour < 8) return { code: "A", label: "Turno A", hours: "00:00 - 08:00" };
  if (hour >= 8 && hour < 16) return { code: "B", label: "Turno B", hours: "08:00 - 16:00" };
  return { code: "C", label: "Turno C", hours: "16:00 - 24:00" };
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
