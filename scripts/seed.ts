import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BrandProfileDataSchema } from "../lib/supabase/types";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const seedPassword = process.env.SEED_PASSWORD;

  if (!supabaseUrl || !serviceRoleKey || !seedPassword) {
    throw new Error(
      "Thiếu NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY hoặc SEED_PASSWORD trong .env.local"
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const usersToSeed: Array<{ email: string; role: "admin" | "editor" }> = [
    { email: "admin@demo.test", role: "admin" },
    { email: "editor@demo.test", role: "editor" },
  ];

  const { data: existingList, error: listErr } =
    await supabase.auth.admin.listUsers();
  if (listErr) {
    throw new Error(`Không thể đọc danh sách user: ${listErr.message}`);
  }

  let adminUserId: string | null = null;

  for (const u of usersToSeed) {
    const found = existingList.users.find((item) => item.email === u.email);
    let userId: string;

    if (found) {
      userId = found.id;
      const { error: updErr } = await supabase.auth.admin.updateUserById(
        userId,
        {
          password: seedPassword,
          email_confirm: true,
        }
      );
      if (updErr) {
        throw new Error(`Lỗi cập nhật user ${u.email}: ${updErr.message}`);
      }
    } else {
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email: u.email,
          password: seedPassword,
          email_confirm: true,
        });
      if (createErr || !created.user) {
        throw new Error(
          `Lỗi tạo user ${u.email}: ${createErr?.message ?? "unknown"}`
        );
      }
      userId = created.user.id;
    }

    if (u.role === "admin") {
      adminUserId = userId;
    }

    const { error: profileErr } = await supabase
      .from("profiles")
      .upsert({ id: userId, role: u.role }, { onConflict: "id" });

    if (profileErr) {
      throw new Error(
        `Lỗi ghi bảng profiles cho ${u.email}: ${profileErr.message}`
      );
    }

    console.log(`Đã seed user ${u.email} (${u.role}) -> ${userId}`);
  }

  const fixturePath = path.join(process.cwd(), "fixtures", "brand.demo.json");
  const rawJson = fs.readFileSync(fixturePath, "utf8");
  const brandData = BrandProfileDataSchema.parse(JSON.parse(rawJson));

  const { error: brandErr } = await supabase.from("brand_profile").upsert(
    {
      id: true,
      brand_name: brandData.brand_name,
      description: brandData.description,
      products: brandData.products,
      voice: brandData.voice,
      facts: brandData.facts,
      forbidden_claims: brandData.forbidden_claims,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (brandErr) {
    throw new Error(`Lỗi nạp brand_profile: ${brandErr.message}`);
  }

  console.log(
    `Đã nạp brand_profile cho thương hiệu "${brandData.brand_name}" (${brandData.products.length} sản phẩm, ${brandData.facts.length} facts).`
  );
}

main().catch((err: unknown) => {
  console.error("Seed thất bại:", err);
  process.exit(1);
});

