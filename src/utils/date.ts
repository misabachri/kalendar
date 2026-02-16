export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function weekday(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

export function weekdayMondayIndex(year: number, month: number, day: number): number {
  const jsDay = weekday(year, month, day);
  return (jsDay + 6) % 7;
}

export function isWeekendServiceDay(year: number, month: number, day: number): boolean {
  const d = weekday(year, month, day);
  return d === 5 || d === 6 || d === 0;
}

export function isFriday(year: number, month: number, day: number): boolean {
  return weekday(year, month, day) === 5;
}

export function monthStartDate(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}

export function dayBeforeMonthStart(year: number, month: number): Date {
  return new Date(year, month - 1, 0);
}

export function sameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
