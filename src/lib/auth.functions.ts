import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ADMIN_EMAILS = ["uuxz272@gmail.com"];
const ADMIN_RECOVERY_CODE = "UUXZ@272";

const signUpSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(72),
  teacherName: z.string().trim().max(120).optional().default(""),
  school: z.string().trim().max(120).optional().default(""),
});

export type SignUpResult =
  | { ok: true }
  | { ok: false; code: "email_exists" | "weak_password" | "invalid" | "failed"; message: string };

/**
 * Creates the account server-side with the email already confirmed, so users
 * never have to open a confirmation email. The client signs in right after.
 */
export const signUpDirect = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signUpSchema.parse(input))
  .handler(async ({ data }): Promise<SignUpResult> => {
    let supabaseAdmin;
    try {
      ({ supabaseAdmin } = await import("@/lib/supabase-admin.server"));
    } catch (e) {
      console.error("[signUpDirect] admin client unavailable", e);
      return {
        ok: false,
        code: "failed",
        message: "تعذّر إنشاء الحساب مباشرة. يجب إيقاف تأكيد البريد من إعدادات الحساب.",
      };
    }

    let error: { message?: string } | null = null;
    let created: { user?: { id?: string } | null } | null = null;
    try {
      ({ data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          teacher_name: data.teacherName,
          school: data.school,
        },
      }));
      const newId = created?.user?.id;
      if (!error && newId) {
        await supabaseAdmin.rpc("bootstrap_account", {
          _user_id: newId,
          _teacher_name: data.teacherName,
          _school: data.school,
        });
        if (ADMIN_EMAILS.includes(data.email.trim().toLowerCase())) {
          await supabaseAdmin
            .from("user_roles")
            .upsert({ user_id: newId, role: "admin" }, { onConflict: "user_id,role" });
        }
      }
    } catch (e) {
      console.error("[signUpDirect] admin call failed", e);
      return {
        ok: false,
        code: "failed",
        message: "تعذّر حفظ الحساب مباشرة. من فضلك أوقف تأكيد البريد من إعدادات تسجيل الدخول.",
      };
    }

    if (!error) return { ok: true };

    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already been registered") || msg.includes("already registered") || msg.includes("exists")) {
      return {
        ok: false,
        code: "email_exists",
        message: "هذا البريد مسجّل بالفعل. سجّل دخولك بدلاً من إنشاء حساب.",
      };
    }
    if (msg.includes("weak") || msg.includes("pwned") || msg.includes("password")) {
      return {
        ok: false,
        code: "weak_password",
        message: "كلمة المرور ضعيفة أو مسرّبة. اختر كلمة مرور أقوى (٨ أحرف مع أرقام ورموز).",
      };
    }
    console.error("[signUpDirect]", error);
    return { ok: false, code: "failed", message: "تعذّر إنشاء الحساب، حاول مرة أخرى." };
  });

const emailSchema = z.object({ email: z.string().trim().email().max(255) });

const resetWithCodeSchema = z.object({
  email: z.string().max(255),
  code: z.string().max(64),
  password: z.string().max(200),
});

export type ResetWithCodeResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "no_account"
        | "bad_code"
        | "weak_password"
        | "invalid_input"
        | "server_config"
        | "failed";
    };

function isMissingAdminConfig(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return msg.includes("Missing Supabase environment variable");
}

/**
 * In-app password reset: an activation serial can be used as the recovery
 * credential on first use. After the new password is successfully saved,
 * the serial is redeemed and the matching subscription starts immediately.
 */
export const resetPasswordWithCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => resetWithCodeSchema.parse(input))
  .handler(async ({ data }): Promise<ResetWithCodeResult> => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const serial = data.code.trim().toUpperCase();
    const newPassword = data.password;

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!emailOk || serial.length < 4) return { ok: false, code: "invalid_input" };
    if (newPassword.trim().length < 6 || newPassword.length > 72) {
      return { ok: false, code: "weak_password" };
    }

    let supabaseAdmin;
    try {
      ({ supabaseAdmin } = await import("@/lib/supabase-admin.server"));
    } catch (e) {
      console.error("[resetPasswordWithCode] admin client unavailable", e);
      return { ok: false, code: isMissingAdminConfig(e) ? "server_config" : "failed" };
    }

    const isAdminRecovery = ADMIN_EMAILS.includes(normalizedEmail) && serial === ADMIN_RECOVERY_CODE;

    // Find the existing account. The special admin recovery may recreate the owner account.
    let target: { id: string } | undefined;
    try {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (error) throw error;
      target = list.users.find((u) => (u.email ?? "").toLowerCase() === normalizedEmail);
      if (!target && isAdminRecovery) {
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password: newPassword,
          email_confirm: true,
        });
        if (createError) throw createError;
        if (created.user) target = { id: created.user.id };
      }
    } catch (e) {
      console.error("[resetPasswordWithCode] listUsers failed", e);
      return { ok: false, code: isMissingAdminConfig(e) ? "server_config" : "failed" };
    }
    if (!target) return { ok: false, code: "no_account" };

    // The serial may be unused (first use) or already redeemed by this account.
    const { data: codeRow, error: codeError } = await supabaseAdmin
      .from("activation_codes")
      .select("id, active, expires_at, max_uses, used_count, plan, duration_days")
      .eq("code", serial)
      .maybeSingle();
    if (codeError && !isAdminRecovery) {
      console.error("[resetPasswordWithCode] code lookup failed", codeError);
      return { ok: false, code: "failed" };
    }

    const codeNeverUsed = !!codeRow && (codeRow.used_count ?? 0) === 0;
    const codeValid =
      !!codeRow &&
      codeRow.active !== false &&
      (codeNeverUsed || !codeRow.expires_at || new Date(codeRow.expires_at).getTime() > Date.now());

    if (!codeValid && !isAdminRecovery) return { ok: false, code: "bad_code" };

    let redemption: { id: string } | null = null;
    if (codeRow) {
      const { data: existingRedemption, error: redemptionLookupError } = await supabaseAdmin
        .from("code_redemptions")
        .select("id")
        .eq("code_id", codeRow.id)
        .eq("user_id", target.id)
        .maybeSingle();
      if (redemptionLookupError) {
        console.error("[resetPasswordWithCode] redemption lookup failed", redemptionLookupError);
        return { ok: false, code: "failed" };
      }
      redemption = existingRedemption;

      if (!redemption && !isAdminRecovery) {
        if ((codeRow.used_count ?? 0) >= (codeRow.max_uses ?? 1)) return { ok: false, code: "bad_code" };
      }
    }

    // Change the password FIRST. The serial is consumed only after the password
    // change succeeds, so a failed password update cannot burn the activation code.
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      target.id,
      { password: newPassword },
    );
    if (updateError) {
      console.error("[resetPasswordWithCode] update failed", updateError);
      const msg = (updateError.message || "").toLowerCase();
      if (msg.includes("weak") || msg.includes("pwned") || msg.includes("password")) {
        return { ok: false, code: "weak_password" };
      }
      return { ok: false, code: "failed" };
    }

    // First use: redeem the serial now and start its subscription immediately.
    if (codeRow && !redemption) {
      const { error: redemptionError } = await supabaseAdmin
        .from("code_redemptions")
        .insert({ code_id: codeRow.id, user_id: target.id });
      if (redemptionError) {
        console.error("[resetPasswordWithCode] serial link failed", redemptionError);
        return { ok: false, code: "failed" };
      }

      const { error: usageError } = await supabaseAdmin
        .from("activation_codes")
        .update({ used_count: (codeRow.used_count ?? 0) + 1 })
        .eq("id", codeRow.id);
      if (usageError) {
        console.error("[resetPasswordWithCode] serial usage update failed", usageError);
        return { ok: false, code: "failed" };
      }

      // Paid serials are stored as standard/premium in activation_codes.
      // Gifts are identified by [GIFT] in note and are intentionally not given
      // a paid subscription here.
      const { data: fullCodeRow } = await supabaseAdmin
        .from("activation_codes")
        .select("plan, duration_days, note")
        .eq("id", codeRow.id)
        .maybeSingle();
      const isGift = (fullCodeRow?.note ?? "").trim().toUpperCase().startsWith("[GIFT]");

      if (!isGift) {
        const expires = new Date();
        expires.setDate(expires.getDate() + (codeRow.duration_days ?? 30));
        const normalizedPlan = codeRow.plan === "standard" ? "standard" : "premium";
        const payload = {
          user_id: target.id,
          plan: normalizedPlan,
          status: "active",
          expires_at: expires.toISOString(),
          generations_used: 0,
          reset_at: new Date().toISOString(),
        };
        const { data: existingSub, error: subLookupError } = await supabaseAdmin
          .from("subscriptions")
          .select("id")
          .eq("user_id", target.id)
          .maybeSingle();
        if (subLookupError) {
          console.error("[resetPasswordWithCode] subscription lookup failed", subLookupError);
          return { ok: false, code: "failed" };
        }
        const { error: subError } = existingSub
          ? await supabaseAdmin.from("subscriptions").update(payload).eq("user_id", target.id)
          : await supabaseAdmin.from("subscriptions").insert(payload);
        if (subError) {
          console.error("[resetPasswordWithCode] subscription activation failed", subError);
          return { ok: false, code: "failed" };
        }
      }
    }

    if (isAdminRecovery) {
      await supabaseAdmin.rpc("bootstrap_account", { _user_id: target.id });
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: target.id, role: "admin" }, { onConflict: "user_id,role" });
      if (roleError) {
        console.error("[resetPasswordWithCode] admin role failed", roleError);
        return { ok: false, code: "failed" };
      }
    }

    return { ok: true };
  });

/**
 * Confirms the email for unconfirmed old accounts.
 * Used during login to unblock accounts that were created before auto-confirm was enabled.
 */
export const confirmUnconfirmedEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    let supabaseAdmin;
    try {
      ({ supabaseAdmin } = await import("@/lib/supabase-admin.server"));
    } catch (e) {
      console.error("[confirmUnconfirmedEmail] admin client unavailable", e);
      return { ok: false };
    }

    try {
      const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (listError) {
        console.error("[confirmUnconfirmedEmail] list error", listError);
        return { ok: false };
      }

      const target = list.users.find(
        (u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase(),
      );

      if (!target) {
        console.warn(`[confirmUnconfirmedEmail] user not found: ${data.email}`);
        return { ok: false };
      }

      if (target.email_confirmed_at) {
        return { ok: true };
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
        email_confirm: true,
      });

      if (updateError) {
        console.error("[confirmUnconfirmedEmail] update error", updateError);
        return { ok: false };
      }

      console.log(`[confirmUnconfirmedEmail] successfully confirmed ${data.email}`);
      return { ok: true };
    } catch (e) {
      console.error("[confirmUnconfirmedEmail] unexpected error", e);
      return { ok: false };
    }
  });
