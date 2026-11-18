import { NextResponse, type NextRequest } from "next/server";
import { processNextAgentJob } from "@/lib/agent/worker";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.AGENT_WORKER_SECRET;
  const providedSecret = request.headers.get("x-worker-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Không có quyền gọi worker (sai x-worker-secret)" },
      { status: 401 }
    );
  }

  try {
    const result = await processNextAgentJob();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Lỗi thực thi agent worker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

