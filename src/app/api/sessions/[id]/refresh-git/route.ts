import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUserId } from "@/lib/auth/api-auth";
import { refreshSessionDiffStateInBackground } from "@/lib/git/session-diff-refresh";
import { jsonError } from "@/lib/http/json-error";

/**
 * Kick off the same git/PR refresh that runs at agent turn-end. Lets the
 * client recover from staleness when work happens outside Tessera (CLI push,
 * external `gh pr create`, etc.) without waiting for the background poll.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireAuthenticatedUserId(request, {
    error: { code: "unauthorized", message: "Unauthorized" },
  });
  if ("response" in auth) return auth.response;

  if (!id) {
    return jsonError("invalid_request", "session id is required", 400);
  }

  refreshSessionDiffStateInBackground(id, auth.userId, "client_refresh_request");
  return NextResponse.json({ ok: true });
}
