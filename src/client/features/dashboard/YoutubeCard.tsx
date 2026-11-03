import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { CardShell } from "@/client/components/CardShell";
import { MetricsTable, percentChange } from "@/client/components/MetricsTable";
import { moreDetailsClass } from "@/client/features/dashboard/cardParts";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import { getYoutubeDashboardReport } from "@/serverFunctions/youtube";

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function changeLabel(current: number | null, previous: number | null): string {
  const change = percentChange(current, previous);
  if (change === null) return "—";
  return `${change > 0 ? "+" : ""}${change}%`;
}

export function YoutubeCard({ projectId }: { projectId: string }) {
  const connectionQuery = useQuery(
    googleConnectionOptions("youtube", projectId),
  );
  const connected = connectionQuery.data?.connected === true;
  const reportQuery = useQuery({
    queryKey: ["dashboardYoutubeReport", projectId],
    queryFn: () => getYoutubeDashboardReport({ data: { projectId } }),
    enabled: connected,
  });
  const report = reportQuery.data;

  if (connectionQuery.isPending) return null;
  if (!connected || (report && !report.connected)) {
    return <GoogleConnectionCard provider="youtube" projectId={projectId} />;
  }

  return (
    <CardShell
      title="YouTube"
      action={
        <Link
          to="/p/$projectId/settings/integrations"
          params={{ projectId }}
          hash="youtube"
          className={moreDetailsClass}
        >
          Manage
        </Link>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {report && report.connected ? report.channelTitle : "YouTube"} · Last 28
        days
      </p>
      {reportQuery.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load YouTube data. Try again shortly.
        </p>
      ) : !report || !report.connected ? (
        <SkeletonTableRows rows={4} columns={3} />
      ) : !report.current.views ? (
        <p className="text-sm text-muted-foreground">
          No views recorded in the last 28 days yet.
        </p>
      ) : (
        <MetricsTable
          showChange
          rows={[
            {
              label: "Views",
              value: formatCount(report.current.views),
              change: changeLabel(report.current.views, report.previous.views),
            },
            {
              label: "Watch time (minutes)",
              value:
                report.current.estimatedMinutesWatched === null
                  ? "—"
                  : formatCount(report.current.estimatedMinutesWatched),
              change: changeLabel(
                report.current.estimatedMinutesWatched,
                report.previous.estimatedMinutesWatched,
              ),
            },
            {
              label: "Avg view duration",
              value:
                report.current.averageViewDuration === null
                  ? "—"
                  : formatDuration(report.current.averageViewDuration),
              change: changeLabel(
                report.current.averageViewDuration,
                report.previous.averageViewDuration,
              ),
            },
            {
              label: "Subscribers gained",
              value:
                report.current.subscribersGained === null
                  ? "—"
                  : formatCount(report.current.subscribersGained),
              change: changeLabel(
                report.current.subscribersGained,
                report.previous.subscribersGained,
              ),
            },
          ]}
        />
      )}
    </CardShell>
  );
}
