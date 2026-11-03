import { sortBy } from "remeda";
import { Bar, BarChart, Line, LineChart } from "recharts";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import { youtubeTrafficSourceLabel } from "@/shared/youtube";
import { formatTrendDay, formatWatchTime } from "./youtubeReportFormat";
import type { YoutubeReport } from "./youtubeReportTypes";

const dailyConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
  estimatedMinutesWatched: {
    label: "Watch time (min)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const trafficConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

function formatAxis(value: unknown) {
  return typeof value === "number" ? formatCount(value) : "";
}

export function YoutubeDailyChart({ rows }: { rows: YoutubeReport["daily"] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 font-medium">Views and watch time</h2>
      <ChartContainer
        config={dailyConfig}
        className="h-64"
        aria-label="Daily views and watch time"
      >
        <LineChart
          data={rows}
          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
        >
          <ChartGrid />
          <ChartXAxis
            dataKey="day"
            tickFormatter={formatTrendDay}
            minTickGap={24}
          />
          <ChartYAxis yAxisId="views" tickFormatter={formatAxis} width={48} />
          <ChartYAxis
            yAxisId="watch"
            orientation="right"
            tickFormatter={formatAxis}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label: unknown) =>
                  typeof label === "string" ? formatTrendDay(label) : ""
                }
                valueFormatter={(value, item) =>
                  item.dataKey === "estimatedMinutesWatched"
                    ? formatWatchTime(Number(value))
                    : formatCount(Number(value))
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            yAxisId="views"
            type="monotone"
            dataKey="views"
            stroke="var(--color-views)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="watch"
            type="monotone"
            dataKey="estimatedMinutesWatched"
            stroke="var(--color-estimatedMinutesWatched)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </section>
  );
}

export function YoutubeTrafficChart({
  rows,
}: {
  rows: YoutubeReport["trafficSources"];
}) {
  const data = sortBy(
    rows.map((row) => ({
      label: youtubeTrafficSourceLabel(
        typeof row.trafficSource === "string" ? row.trafficSource : "",
      ),
      views: typeof row.views === "number" ? row.views : 0,
    })),
    [(row) => row.views, "desc"],
  ).slice(0, 8);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 font-medium">Traffic sources</h2>
      {data.length === 0 ? (
        <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          No traffic sources in this range.
        </p>
      ) : (
        <ChartContainer
          config={trafficConfig}
          className="h-64"
          aria-label="Views by traffic source"
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 8, right: 16, top: 8, bottom: 0 }}
          >
            <ChartGrid horizontal={false} />
            <ChartXAxis type="number" tickFormatter={formatAxis} />
            <ChartYAxis
              type="category"
              dataKey="label"
              width={128}
              interval={0}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  valueFormatter={(value) => formatCount(Number(value))}
                />
              }
            />
            <Bar
              dataKey="views"
              fill="var(--color-views)"
              radius={[0, 2, 2, 0]}
              maxBarSize={18}
            />
          </BarChart>
        </ChartContainer>
      )}
    </section>
  );
}
