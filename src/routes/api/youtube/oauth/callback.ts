import { createFileRoute } from "@tanstack/react-router";
import {
  handleGoogleOAuthCallbackRequest,
  YOUTUBE_INTEGRATION,
} from "@/server/features/google/googleOAuth";

export const Route = createFileRoute("/api/youtube/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleGoogleOAuthCallbackRequest(request, YOUTUBE_INTEGRATION),
    },
  },
});
