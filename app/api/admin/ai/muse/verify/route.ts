import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedActor } from "@/lib/ai/api-auth";
import {
  ConnectorAuthorizationError,
  verifyStoredMuseConnection,
} from "@/lib/ai/connector-manager";
import { redactSecretsFromLog } from "@/lib/ai/secret-vault";

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveAuthenticatedActor(request, true);
    const status = await verifyStoredMuseConnection({
      actorId: actor.userId,
      actorRole: actor.role,
    });

    return NextResponse.json({ status });
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
        : "Không thể xác minh kết nối Muse AI";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

