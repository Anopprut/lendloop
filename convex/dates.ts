// Dates are plain "YYYY-MM-DD" strings so that comparison is lexicographic and timezone-free.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Inclusive ranges overlap. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
