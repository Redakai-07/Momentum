/** 135 → "2h 15m"; 45 → "45m"; 60 → "1h"; 90 → "1h 30m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "0m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

/** Compact variant for chips: 90 → "1h30", 45 → "45m". */
export function formatMinutesCompact(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "0m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h${String(rem).padStart(2, "0")}`;
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
