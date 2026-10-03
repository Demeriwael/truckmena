export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return (
    [hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}

// Read the wall clock in the API's frozen offset, rather than the browser's zone.
export function eventTime(value: string): string {
  const wallClock = new Date(`${value.slice(0, 19)}Z`);
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(wallClock)} · UTC${value.slice(-6) === "+00:00" || value.endsWith("Z") ? "+00:00" : value.slice(-6)}`;
}

export function clockTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 19)}Z`));
}

export function calendarDay(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function tripOffset(value: string): string {
  return `UTC${value.endsWith("Z") ? "+00:00" : value.slice(-6)}`;
}

export function milesLabel(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
