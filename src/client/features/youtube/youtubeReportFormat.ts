import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function formatWatchTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    const text =
      hours >= 10
        ? Math.round(hours).toLocaleString("en-US")
        : hours.toFixed(1);
    return `${text} h`;
  }
  return `${Math.round(minutes).toLocaleString("en-US")} min`;
}

export function formatRatio(
  ratio: number | null,
): { text: string; improved: boolean } | null {
  if (ratio === null) return null;
  return {
    text: `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`,
    improved: ratio >= 0,
  };
}

export function formatEvidence(label: string, value: number): string {
  if (label.includes("(seconds)")) return formatDuration(value);
  if (label.includes("(minutes)")) return formatWatchTime(value);
  return formatCount(value);
}

export function formatTrendDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function deltaClass(improved: boolean | null): string {
  if (improved === null) return "text-muted-foreground";
  return improved ? "text-success" : "text-destructive";
}
