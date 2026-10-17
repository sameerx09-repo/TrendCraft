import { engagementPublishingStatus } from "@/lib/engagement/publishing-status";
export async function GET() {
  return Response.json(engagementPublishingStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
