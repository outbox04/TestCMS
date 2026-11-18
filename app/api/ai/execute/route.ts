import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { executeSharedAiTask } from "@/lib/ai/ai-orchestrator";
import { resolveAuthenticatedActor } from "@/lib/ai/api-auth";
import { ConnectorAuthorizationError } from "@/lib/ai/connector-manager";
import { redactSecretsFromLog } from "@/lib/ai/secret-vault";

const ExecuteRequestSchema = z.object({
  task_type: z.enum([
    "research",
    "plan_outline",
    "write_article",
    "seo_geo_aeo_optimize",
    "fact_check",
    "custom_prompt",
  ]),
  prompt: z.string().min(1),
  system_instruction: z.string().optional(),
  article_id: z.string().nullable().optional(),
  timeout_ms: z.number().int().positive().max(60000).optional(),
  idempotency_key: z.string().optional(),
  allow_fallback_before_start: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveAuthenticatedActor(request, true);
    const body = ExecuteRequestSchema.parse(await request.json());

    const result = await executeSharedAiTask({
      actorId: actor.userId,
      actorRole: actor.role,
      task: body,
    });

    // Tuyệt đối không trả về cookie/token trong phản hồi execute
    return NextResponse.json(
      { result },
      { status: result.ok ? 200 : 422 }
    );
  } catch (err) {
    if (err instanceof ConnectorAuthorizationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.httpStatus }
      );
    }
    const msg =
      err instanceof Error
        ? redactSecretsFromLog(err.message)
        : "Lỗi thực thi tác vụ AI";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

