import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.AGENT_WORKER_SECRET;
  const providedSecret = request.headers.get("x-worker-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Không có quyền gọi publish-due (sai x-worker-secret)" },
      { status: 401 }
    );
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("publish_due_articles");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const publishedCount = Number(data ?? 0);
    if (publishedCount > 0) {
      revalidatePath("/blog");
    }
    return NextResponse.json({
      published_count: publishedCount,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Lỗi gọi publish_due_articles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

