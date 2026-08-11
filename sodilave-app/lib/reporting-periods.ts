export type ReportingPeriods = {
  day: Date;
  week: Date;
  month: Date;
  quarter: Date;
  semester: Date;
  year: Date;
};

export function getReportingPeriods(now = new Date()): ReportingPeriods {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day);
  const mondayOffset = (day.getDay() + 6) % 7;
  week.setDate(day.getDate() - mondayOffset);

  return {
    day,
    week,
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    quarter: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
    semester: new Date(now.getFullYear(), Math.floor(now.getMonth() / 6) * 6, 1),
    year: new Date(now.getFullYear(), 0, 1),
  };
}

export function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSince(value: Date, start: Date) {
  return value.getTime() >= start.getTime();
}
