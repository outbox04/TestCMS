import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveAuthenticatedActor } from "@/lib/ai/api-auth";
import {
  ConnectorAuthorizationError,
  connectOrUpdateMuseCredentials,
} from "@/lib/ai/connector-manager";
import { redactSecretsFromLog } from "@/lib/ai/secret-vault";

const UpdateCredentialsSchema = z.object({
  auth_type: z.enum(["cookie", "api_token", "oauth"]).default("api_token"),
  credential_value: z.string().min(1),
  account_label: z.string().optional(),
});

export async function PUT(request: NextRequest) {
  try {
    const actor = await resolveAuthenticatedActor(request, true);
    const body = UpdateCredentialsSchema.parse(await request.json());

    const status = await connectOrUpdateMuseCredentials(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        authType: body.auth_type,
        credentialValue: body.credential_value,
        accountLabel: body.account_label ?? null,
      },
      "update"
    );

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
        : "Lỗi cập nhật thông tin xác thực Muse AI";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

