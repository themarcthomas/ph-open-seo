const DAY_MILLISECONDS = 86_400_000;

export function shiftYoutubeDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()))
    throw new RangeError("Invalid YouTube date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function youtubeDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function inclusiveYoutubeDays(
  startDate: string,
  endDate: string,
): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.valueOf() - start.valueOf()) / DAY_MILLISECONDS) + 1;
}

export function previousYoutubeRange(startDate: string, endDate: string) {
  const days = inclusiveYoutubeDays(startDate, endDate);
  const previousEnd = shiftYoutubeDate(startDate, -1);
  return {
    startDate: shiftYoutubeDate(previousEnd, -(days - 1)),
    endDate: previousEnd,
  };
}
