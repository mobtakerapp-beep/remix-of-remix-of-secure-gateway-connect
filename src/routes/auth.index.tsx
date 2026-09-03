import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Home, Lock, Mail, School, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import partyImg from "@/assets/party.png";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

import { confirmUnconfirmedEmail, resetPasswordWithCode, signUpDirect } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { saveProfile } from "@/lib/subscription.functions";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — ملخصي" },
      { name: "description", content: "سجّل دخولك أو أنشئ حسابًا للوصول إلى ملخصي." },
      { property: "og:title", content: "تسجيل الدخول — ملخصي" },
      { property: "og:description", content: "سجّل دخولك أو أنشئ حسابًا للوصول إلى ملخصي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const createAccount = useServerFn(signUpDirect);
  const confirmUnconfirmed = useServerFn(confirmUnconfirmedEmail);
  const saveProfileFn = useServerFn(saveProfile);
  const resetPasswordFn = useServerFn(resetPasswordWithCode);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [school, setSchool] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const ar = lang === "ar";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const toggleReset = () => {
    setShowReset((v) => !v);
    if (!showReset) {
      setResetCode("");
      setResetPassword("");
    }
  };

  const resetWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail || !resetCode.trim() || !resetPassword.trim()) {
      toast.error(ar ? "أكمل جميع الحقول." : "Fill in all fields.");
      return;
    }
    setResetting(true);
    try {
      const result = await resetPasswordFn({
        data: { email: targetEmail, code: resetCode.trim(), password: resetPassword },
      });
      if (!result.ok) {
        if (result.code === "no_account") throw new Error(ar ? "لا يوجد حساب بهذا البريد." : "No account found with this email.");
        if (result.code === "bad_code") throw new Error(ar ? "كود التفعيل غير صحيح أو منتهي الصلاحية." : "Activation code is invalid or expired.");
        if (result.code === "weak_password") throw new Error(ar ? "كلمة المرور ضعيفة. استخدم ٦ أحرف على الأقل مع أرقام ورموز." : "Password is too weak. Use at least 6 characters with numbers and symbols.");
        if (result.code === "invalid_input") throw new Error(ar ? "بيانات غير صالحة: تحقّق من البريد الإلكتروني وكود التفعيل." : "Invalid input: check the email address and activation code.");
        if (result.code === "server_config") throw new Error(ar ? "إعدادات الخادم ناقصة. تواصل مع الدعم." : "Server configuration is incomplete. Contact support.");
        throw new Error(ar ? "تعذّر إعادة تعيين كلمة المرور." : "Could not reset password.");
      }
      toast.success(ar ? "تم تغيير كلمة المرور. يمكنك الآن تسجيل الدخول." : "Password changed. You can now sign in.");
      setShowReset(false);
      setResetCode("");
      setResetPassword("");
      setMode("login");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      toast.error(raw || (ar ? "تعذّر إعادة تعيين كلمة المرور" : "Could not reset password"));
    } finally {
      setResetting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        let created: Awaited<ReturnType<typeof createAccount>>;
        try {
          created = await createAccount({
            data: { email: email.trim(), password, teacherName: teacherName.trim(), school: school.trim() },
          });
        } catch {
          created = { ok: false, code: "failed", message: "" };
        }
        if (!created.ok && created.code === "failed") {
          const { error: signUpError } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: `${window.location.origin}/`, data: { teacher_name: teacherName.trim(), school: school.trim() } },
          });
          if (signUpError) throw signUpError;
        } else if (!created.ok) {
          throw new Error(created.message);
        }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        try {
          await saveProfileFn({ data: { teacherName: teacherName.trim(), school: school.trim() } });
        } catch {
          // non-blocking
        }
        toast.success(ar ? "تم إنشاء الحساب وتسجيل الدخول!" : "Account created — you're signed in!");
        navigate({ to: "/" });
      } else {
        let { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error && /confirm|unconfirm/i.test(error.message)) {
          try {
            await confirmUnconfirmed({ data: { email: email.trim() } });
            ({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
          } catch (confirmError) {
            console.error("Failed to confirm email:", confirmError);
          }
        }
        if (error) throw error;
        toast.success(ar ? "تم تسجيل الدخول!" : "Signed in!");
        navigate({ to: "/" });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const friendly = /invalid login credentials/i.test(raw)
        ? ar ? "البريد أو كلمة المرور غير صحيحة." : "Invalid email or password."
        : /weak|pwned/i.test(raw)
          ? ar ? "كلمة المرور ضعيفة أو مسرّبة، اختر كلمة مرور أقوى." : "Password is too weak or leaked."
          : raw || (ar ? "تعذّر إتمام العملية" : "Authentication failed");
      toast.error(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="blob-bg flex min-h-screen items-center justify-center bg-background p-4">
      <Toaster position="top-center" />
      <Card className="w-full max-w-md rounded-3xl border-border/70 p-6 shadow-[var(--shadow-lift)] sm:p-8" dir={ar ? "rtl" : "ltr"}>
        <Link to="/" aria-label={ar ? "الرجوع للصفحة الرئيسية" : "Back to home"} title={ar ? "الرجوع للصفحة الرئيسية" : "Back to home"} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Home className="size-3.5" />
          {ar ? "الرئيسية" : "Home"}
        </Link>
        <div className="text-center">
          <img src={partyImg} alt="" className="mx-auto size-16 animate-bounce-slow" />
          <h1 className="mt-3 font-display text-2xl font-extrabold text-primary">
            {mode === "login" ? (ar ? "تسجيل الدخول" : "Sign in") : (ar ? "إنشاء حساب جديد" : "Create account")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{ar ? "ملخصي للمعلمين" : "Malakhasi for teachers"}</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4" autoComplete="on">
          {mode === "signup" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="teacher">{t.teacherName}</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
                  <Input id="teacher" name="name" autoComplete="name" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder={t.teacherPlaceholder} className="rounded-xl ltr:pl-10 rtl:pr-10" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school">{ar ? "المدرسة" : "School"}</Label>
                <div className="relative">
                  <School className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
                  <Input id="school" name="organization" autoComplete="organization" value={school} onChange={(e) => setSchool(e.target.value)} placeholder={ar ? "اسم المدرسة (اختياري)" : "School name (optional)"} className="rounded-xl ltr:pl-10 rtl:pr-10" />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
              <Input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={ar ? "بريدك الإلكتروني" : "your@email.com"} className="rounded-xl ltr:pl-10 rtl:pr-10" required />
            </div>
          </div>

          {!showReset && (
            <div className="space-y-1.5">
              <Label htmlFor="password">{ar ? "كلمة المرور" : "Password"}</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
                <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="rounded-xl ltr:pl-10 rtl:pr-10" required />
              </div>
            </div>
          )}

          <div className="flex justify-end text-xs">
            <button type="button" className="text-primary hover:underline" onClick={toggleReset}>
              {showReset ? (ar ? "العودة لتسجيل الدخول" : "Back to sign in") : (ar ? "نسيت كلمة المرور؟" : "Forgot password?")}
            </button>
          </div>

          {showReset && (
            <div className="space-y-4 rounded-2xl border border-border p-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-code">{ar ? "كود التفعيل" : "Activation code"}</Label>
                <Input id="reset-code" name="activation_code" autoComplete="off" value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder={ar ? "اكتب كود التفعيل" : "Enter activation code"} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">{ar ? "كلمة المرور الجديدة" : "New password"}</Label>
                <Input id="reset-password" name="new_password" type="password" autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="••••••••" className="rounded-xl" />
              </div>
              <Button type="button" className="w-full rounded-xl" onClick={(e) => void resetWithCode(e as unknown as React.FormEvent)} disabled={resetting}>
                {resetting ? (ar ? "جارٍ التغيير…" : "Changing…") : (ar ? "تغيير كلمة المرور" : "Change password")}
              </Button>
            </div>
          )}

          {!showReset && (
            <Button type="submit" className="w-full rounded-xl" disabled={loading}>
              {loading ? (ar ? "جارٍ المعالجة…" : "Processing…") : mode === "login" ? (ar ? "تسجيل الدخول" : "Sign in") : (ar ? "إنشاء الحساب" : "Create account")}
            </Button>
          )}
        </form>

        <div className="mt-5 text-center text-xs text-muted-foreground">
          <button type="button" className="text-primary hover:underline" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setShowReset(false); setResetCode(""); setResetPassword(""); }}>
            {mode === "login" ? (ar ? "ليس لديك حساب؟ إنشاء حساب" : "Don't have an account? Create one") : (ar ? "لديك حساب بالفعل؟ تسجيل الدخول" : "Already have an account? Sign in")}
          </button>
        </div>
      </Card>
    </main>
  );
}
