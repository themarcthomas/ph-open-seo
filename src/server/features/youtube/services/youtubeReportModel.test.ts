import { describe, expect, it } from "vitest";
import { resolveYoutubePreset } from "./youtubeReportModel";

describe("resolveYoutubePreset", () => {
  it("uses the last 28 complete days in America/Los_Angeles", () => {
    // 08:00 UTC is still the previous calendar day in Pacific Time.
    const early = resolveYoutubePreset(
      "last_28_days",
      new Date("2026-04-02T06:30:00.000Z"),
    );
    expect(early).toMatchObject({
      startDate: "2026-03-04",
      endDate: "2026-03-31",
    });

    const later = resolveYoutubePreset(
      "last_28_days",
      new Date("2026-04-02T08:00:00.000Z"),
    );
    expect(later).toMatchObject({
      startDate: "2026-03-05",
      endDate: "2026-04-01",
      previousStartDate: "2026-02-05",
      previousEndDate: "2026-03-04",
    });
  });

  it("counts last 7 days and three calendar months back from yesterday", () => {
    const now = new Date("2026-04-02T08:00:00.000Z");
    expect(resolveYoutubePreset("last_7_days", now)).toMatchObject({
      startDate: "2026-03-26",
      endDate: "2026-04-01",
    });
    expect(resolveYoutubePreset("last_3_months", now)).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    });
  });
});
