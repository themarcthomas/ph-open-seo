import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  deltaClass,
  formatDuration,
  formatRatio,
  formatWatchTime,
} from "./youtubeReportFormat";
import type { YoutubeReport } from "./youtubeReportTypes";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type VideoRow = YoutubeReport["videos"][number] & {
  viewsChange: number | null;
};
type TermRow = YoutubeReport["searchTerms"][number];

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

const videoHelper = createColumnHelper<VideoRow>();
const termHelper = createColumnHelper<TermRow>();

function videoColumns() {
  return [
    videoHelper.accessor("title", {
      header: () => "Video",
      cell: ({ row }) => {
        const title = row.original.title?.trim() || row.original.videoId;
        const href = VIDEO_ID.test(row.original.videoId)
          ? `https://www.youtube.com/watch?v=${row.original.videoId}`
          : undefined;
        return href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block max-w-sm truncate text-primary underline-offset-4 hover:underline"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span className="block max-w-sm truncate" title={title}>
            {title}
          </span>
        );
      },
    }),
    videoHelper.accessor("views", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Views" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatCount(value);
      },
      meta: rightAligned,
    }),
    videoHelper.accessor("estimatedMinutesWatched", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Watch time" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatWatchTime(value);
      },
      meta: rightAligned,
    }),
    videoHelper.accessor("averageViewDuration", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Avg. duration" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatDuration(value);
      },
      meta: rightAligned,
    }),
    videoHelper.accessor("viewsChange", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Change" align="right" />
      ),
      cell: ({ row }) => {
        const change = formatRatio(row.original.viewsChange);
        const previous = row.original.previousViews;
        return (
          <span
            className={deltaClass(change ? change.improved : null)}
            title={
              previous === null
                ? undefined
                : `Previous period: ${formatCount(previous)} views`
            }
          >
            {change?.text ?? "—"}
          </span>
        );
      },
      meta: rightAligned,
      sortUndefined: "last",
    }),
  ];
}

function termColumns() {
  return [
    termHelper.accessor("term", {
      header: () => "Search term",
      cell: ({ getValue }) => (
        <span className="block max-w-md truncate" title={getValue()}>
          {getValue() || "—"}
        </span>
      ),
    }),
    termHelper.accessor("views", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Views" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatCount(value);
      },
      meta: rightAligned,
    }),
    termHelper.accessor("estimatedMinutesWatched", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Watch time" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatWatchTime(value);
      },
      meta: rightAligned,
    }),
  ];
}

export function YoutubeVideosTable({
  rows,
}: {
  rows: YoutubeReport["videos"];
}) {
  const data = useMemo<VideoRow[]>(
    () =>
      rows.map((row) => ({
        ...row,
        viewsChange:
          row.views === null ||
          row.previousViews === null ||
          row.previousViews === 0
            ? null
            : (row.views - row.previousViews) / row.previousViews,
      })),
    [rows],
  );
  const columns = useMemo(() => videoColumns(), []);
  const table = useDataTable({
    data,
    columns,
    withSorting: true,
    initialState: { sorting: [{ id: "views", desc: true }] },
  });
  return (
    <DataTable
      table={table}
      empty={{
        title: "No videos in this range",
        description:
          "YouTube has not reported any video views for these dates.",
      }}
    />
  );
}

export function YoutubeSearchTermsTable({
  rows,
}: {
  rows: YoutubeReport["searchTerms"];
}) {
  const columns = useMemo(() => termColumns(), []);
  const table = useDataTable({
    data: rows,
    columns,
    withSorting: true,
    initialState: { sorting: [{ id: "views", desc: true }] },
  });
  return (
    <DataTable
      table={table}
      empty={{
        title: "No YouTube search terms",
        description: "YouTube search did not send views in this range.",
      }}
    />
  );
}
