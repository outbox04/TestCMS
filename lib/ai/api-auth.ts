import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ProfileRow, UserRole } from "@/lib/supabase/types";
import { ConnectorAuthorizationError } from "./connector-manager";
import { verifyCsrfAndOrigin } from "./secret-vault";

export interface AuthenticatedActor {
  userId: string;
  role: UserRole;
}

export async function resolveAuthenticatedActor(
  request?: Request,
  requireCsrfCheck: boolean = false
): Promise<AuthenticatedActor> {
  if (request && requireCsrfCheck) {
    const csrf = verifyCsrfAndOrigin(request);
    if (!csrf.valid) {
      throw new ConnectorAuthorizationError(
        "CSRF_REJECTED",
        csrf.reason ?? "Yêu cầu bị từ chối do kiểm tra CSRF.",
        403
      );
    }
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ConnectorAuthorizationError(
      "UNAUTHENTICATED",
      "Chưa đăng nhập vào hệ thống quản trị.",
      401
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as ProfileRow | null;
  if (!profile || (profile.role !== "admin" && profile.role !== "editor")) {
    throw new ConnectorAuthorizationError(
      "FORBIDDEN_NO_PROFILE",
      "Tài khoản không có quyền truy cập CMS.",
      403
    );
  }

  return {
    userId: user.id,
    role: profile.role,
  };
}

