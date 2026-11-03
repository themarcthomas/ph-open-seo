import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
import { getYoutubeReport } from "@/serverFunctions/youtubeReport";
import {
  YOUTUBE_REPORT_RANGES,
  type YoutubeReportRange,
} from "@/shared/youtube";
import type { YoutubeReportSearch } from "@/types/schemas/youtube-report";
import { YoutubeDailyChart, YoutubeTrafficChart } from "./YoutubeReportCharts";
import {
  YoutubeSearchTermsTable,
  YoutubeVideosTable,
} from "./YoutubeReportTables";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  deltaClass,
  formatDuration,
  formatEvidence,
  formatRatio,
  formatWatchTime,
} from "./youtubeReportFormat";
import type { YoutubeReport } from "./youtubeReportTypes";

const RANGE_LABELS: Record<YoutubeReportRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_3_months: "Last 3 months",
};
const RANGE_OPTIONS = YOUTUBE_REPORT_RANGES.map((value) => ({
  value,
  label: RANGE_LABELS[value],
}));

function isRange(value: string): value is YoutubeReportRange {
  return YOUTUBE_REPORT_RANGES.some((option) => option === value);
}

function metricText(
  value: number | null,
  format: (value: number) => string,
): string {
  return value === null ? "—" : format(value);
}

function SummaryCards({ report }: { report: YoutubeReport }) {
  const cards = [
    {
      label: "Views",
      value: metricText(report.comparison.views.current, formatCount),
      change: formatRatio(report.comparison.views.percentChange),
    },
    {
      label: "Watch time",
      value: metricText(
        report.comparison.estimatedMinutesWatched.current,
        formatWatchTime,
      ),
      change: formatRatio(
        report.comparison.estimatedMinutesWatched.percentChange,
      ),
    },
    {
      label: "Avg. view duration",
      value: metricText(
        report.comparison.averageViewDuration.current,
        formatDuration,
      ),
      change: formatRatio(report.comparison.averageViewDuration.percentChange),
    },
    {
      label: "Subscribers net",
      value: metricText(report.comparison.subscribersNet.current, formatCount),
      change: formatRatio(report.comparison.subscribersNet.percentChange),
    },
    {
      label: "Shares",
      value: metricText(report.comparison.shares.current, formatCount),
      change: formatRatio(report.comparison.shares.percentChange),
    },
  ];
  const compared = `Compared with ${report.request.previousStartDate} to ${report.request.previousEndDate}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-border bg-card p-4"
        >
          <p className="text-sm text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {card.value}
          </p>
          <p
            className={`mt-1 text-sm tabular-nums ${deltaClass(card.change ? card.change.improved : null)}`}
            title={compared}
          >
            {card.change?.text ?? "—"}
          </p>
        </div>
      ))}
    </div>
  );
}

function Opportunities({ report }: { report: YoutubeReport }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-medium">Opportunities</h2>
        <p className="text-sm text-muted-foreground">
          Ideas from this channel&apos;s numbers
          {report.searchConsole === "connected"
            ? " and Google Search Console"
            : ""}
          .
        </p>
      </div>
      {report.opportunities.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nothing stands out in this range.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {report.opportunities.map((item) => (
            <li key={`${item.kind}-${item.headline}`} className="px-4 py-3">
              <p className="font-medium">{item.headline}</p>
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {item.evidence.map((entry) => (
                  <div key={entry.label}>
                    <dt className="inline text-muted-foreground">
                      {entry.label}:{" "}
                    </dt>
                    <dd className="inline tabular-nums">
                      {formatEvidence(entry.label, entry.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonTableRows columns={5} />
      </div>
    </div>
  );
}

function ConnectPrompt({ projectId }: { projectId: string }) {
  return (
    <div className="max-w-xl rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Connect YouTube</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect a channel to see views, watch time, traffic sources, and video
        ideas for this project.
      </p>
      <Button
        className="mt-4"
        nativeButton={false}
        render={
          <Link
            to="/p/$projectId/settings/integrations"
            params={{ projectId }}
            hash="youtube"
          />
        }
      >
        Connect in Integrations
      </Button>
    </div>
  );
}

export function YoutubeReportPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: YoutubeReportSearch;
  onSearchChange: (update: Partial<YoutubeReportSearch>) => void;
}) {
  const range = search.range ?? "last_28_days";
  const reportQuery = useQuery({
    queryKey: ["youtubeReport", projectId, range],
    queryFn: () => getYoutubeReport({ data: { projectId, dateRange: range } }),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">YouTube</h1>
            <p className="text-sm text-muted-foreground">
              {report && report.connected
                ? `${report.source.channelTitle} · ${report.request.startDate} to ${report.request.endDate} · Pacific Time`
                : "Views, watch time, and video ideas from the connected channel."}
            </p>
          </div>
          {report?.connected ? (
            <div className="flex flex-wrap items-center gap-3">
              {reportQuery.isFetching && !reportQuery.isPending ? (
                <Spinner className="size-4 text-muted-foreground" />
              ) : null}
              <Select
                items={RANGE_OPTIONS}
                value={range}
                onValueChange={(value) => {
                  if (value != null && isRange(value)) {
                    onSearchChange({ range: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-36"
                  aria-label="Date range"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                hash="youtube"
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Change channel
              </Link>
            </div>
          ) : null}
        </div>

        {reportQuery.isPending ? (
          <LoadingState />
        ) : !report ? (
          <QueryError
            error={reportQuery.error}
            fallback="Failed to load YouTube analytics"
            onRetry={() => void reportQuery.refetch()}
            isRetrying={reportQuery.isFetching}
          />
        ) : !report.connected ? (
          <ConnectPrompt projectId={projectId} />
        ) : (
          <>
            {reportQuery.isError ? (
              <QueryError
                error={reportQuery.error}
                fallback="Failed to load YouTube analytics"
                onRetry={() => void reportQuery.refetch()}
                isRetrying={reportQuery.isFetching}
              />
            ) : null}
            <SummaryCards report={report} />
            <div className="grid gap-4 lg:grid-cols-2">
              <YoutubeDailyChart rows={report.daily} />
              <YoutubeTrafficChart rows={report.trafficSources} />
            </div>
            <div className="space-y-2">
              <h2 className="font-medium">Top videos</h2>
              <YoutubeVideosTable rows={report.videos} />
            </div>
            <div className="space-y-2">
              <h2 className="font-medium">YouTube search terms</h2>
              <YoutubeSearchTermsTable rows={report.searchTerms} />
            </div>
            <Opportunities report={report} />
          </>
        )}
      </div>
    </div>
  );
}
