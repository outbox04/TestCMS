import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedActor } from "@/lib/ai/api-auth";
import {
  ConnectorAuthorizationError,
  assertAdminRole,
  getMuseConnectionStatus,
  getMuseProviderLogs,
} from "@/lib/ai/connector-manager";
import { redactSecretsFromLog } from "@/lib/ai/secret-vault";

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveAuthenticatedActor(request, false);
    assertAdminRole(actor.role);

    const status = await getMuseConnectionStatus();
    const logs = await getMuseProviderLogs(20);

    // Tuyệt đối không trả về cookie/token hay encrypted_credentials
    return NextResponse.json({ status, logs });
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
        : "Không thể đọc trạng thái Muse AI";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

