import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { YoutubeReportPage } from "@/client/features/youtube/YoutubeReportPage";
import { youtubeReportSearchSchema } from "@/types/schemas/youtube-report";

export const Route = createFileRoute("/_app/p/$projectId/youtube")({
  validateSearch: youtubeReportSearchSchema,
  search: {
    middlewares: [stripSearchParams({ range: "last_28_days" })],
  },
  component: YoutubeRoute,
});

function YoutubeRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <YoutubeReportPage
      projectId={projectId}
      search={search}
      onSearchChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
