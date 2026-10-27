const DAY_IN_MS = 86_400_000;

export function utcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function tripDuration(startDate: Date, endDate: Date) {
  return Math.round((utcDay(endDate) - utcDay(startDate)) / DAY_IN_MS) + 1;
}

export function calendarDays(startDate: Date, endDate: Date) {
  const start = utcDay(startDate);
  return Array.from({ length: tripDuration(startDate, endDate) }, (_, index) => {
    const date = new Date(start + index * DAY_IN_MS);
    return { date, key: dayKey(date), number: index + 1 };
  });
}

export function formatDate(date: Date, withYear = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
    .format(date)
    .replace(' г.', '');
}

export function formatDateRange(startDate: Date, endDate: Date) {
  const sameMonth =
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth();

  if (sameMonth) {
    return `${startDate.getUTCDate()} — ${formatDate(endDate, true)}`;
  }

  return `${formatDate(startDate)} — ${formatDate(endDate, true)}`;
}

export function pluralize(value: number, one: string, few: string, many: string) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
