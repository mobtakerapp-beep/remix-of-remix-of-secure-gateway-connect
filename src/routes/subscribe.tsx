import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Crown, KeyRound, MessageCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { InstallPWA } from "@/components/InstallPWA";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { redeemCode } from "@/lib/access.functions";
import { getMySubscription, type SubscriptionStatus } from "@/lib/subscription.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/subscribe")({
  head: () => ({ meta: [
    { title: "الاشتراك — ملخصي" },
    { name: "description", content: "اختر الخطة العادية أو المميزة في ملخصي، وفعّل اشتراكك بكود التفعيل." },
    { property: "og:title", content: "اشتراكات ملخصي" },
    { property: "og:description", content: "العادي $7 شهريًا أو $50 سنويًا، والمميز $15 شهريًا أو $100 سنويًا." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ]}),
  component: SubscribePage,
});

const WHATSAPP = "96872681302";

const PLANS = [
  { id: "standard", nameAr: "الاشتراك العادي", nameEn: "Standard", monthlyPrice: 7, yearlyPrice: 50, descAr: "3 دروس يوميًا + نص وصور + PDF حتى صفحتين", descEn: "3 lessons/day + text and images + PDF up to 2 pages" },
  { id: "premium", nameAr: "الاشتراك المميز", nameEn: "Premium", monthlyPrice: 15, yearlyPrice: 100, descAr: "3 دروس يوميًا + نص وصور + PDF حتى 3 صفحات + فيديو حتى دقيقتين", descEn: "3 lessons/day + text and images + PDF up to 3 pages + video up to 2 minutes" },
] as const;

function waLink(plan: (typeof PLANS)[number], period: "monthly" | "yearly", email?: string, contactOnly = false) {
  const price = period === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
  const periodAr = period === "yearly" ? "سنوي" : "شهري";
  const periodEn = period === "yearly" ? "Yearly" : "Monthly";
  const text = contactOnly
    ? `مرحبًا، عندي استفسار عن ملخصي.${email ? ` بريدي: ${email}` : ""}`
    : `مرحبًا، أريد الاشتراك في ${plan.nameAr} ${periodAr} بسعر ${price}$.${email ? ` بريد حسابي: ${email}` : ""}`;
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

function deviceFingerprint() { if (typeof window === "undefined") return ""; return `${window.navigator.userAgent.slice(0, 80)}|${window.screen.width}x${window.screen.height}`; }

function SubscribePage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const redeem = useServerFn(redeemCode);
  const fetchSub = useServerFn(getMySubscription);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => { void (async () => { const { data } = await supabase.auth.getSession(); setSignedIn(Boolean(data.session)); if (!data.session) return; try { setStatus(await fetchSub({ data: undefined } as never)); } catch {} })(); }, [fetchSub]);

  const activate = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await redeem({ data: { code, device: deviceFingerprint() } });
      if (res.ok) { toast.success(ar ? "تم تفعيل اشتراكك بنجاح 🎉" : "Subscription activated 🎉"); setStatus(await fetchSub({ data: undefined } as never)); setCode(""); }
      else { const msgs: Record<string, string> = { invalid: ar ? "الكود غير صحيح أو موقوف" : "Invalid or disabled code", expired: ar ? "انتهت صلاحية الكود" : "Code expired", used_up: ar ? "تم استخدام هذا الكود بالكامل" : "This code has been fully used" }; toast.error(msgs[res.reason] || res.reason || (ar ? "تعذّر التفعيل" : "Activation failed")); }
    } catch (err: any) { const serverError = err?.message || err?.toString(); toast.error(serverError && serverError !== "Error" ? `${ar ? "خطأ: " : "Error: "}${serverError}` : ar ? "تعذّر التفعيل، حاول لاحقًا" : "Could not activate, try again"); }
    finally { setBusy(false); }
  };

  const planName = (plan: SubscriptionStatus["plan"]) => plan === "premium" ? (ar ? "مميزة" : "Premium") : plan === "standard" ? (ar ? "عادية" : "Standard") : (ar ? "مجانية" : "Free");

  return (
    <div className="min-h-screen bg-background px-4 py-10" dir={ar ? "rtl" : "ltr"}>
      <Toaster />
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between"><Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowRight className="size-4 rtl:rotate-180" /> {ar ? "رجوع" : "Back"}</Link><InstallPWA /></div>
        <div className="text-center"><div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl gradient-warm text-primary-foreground"><Crown className="size-7" /></div><h1 className="text-2xl font-bold">{ar ? "خطط اشتراك ملخصي" : "Malakhasi plans"}</h1><p className="mt-2 text-sm text-muted-foreground">{ar ? "التجربة المجانية مرة واحدة فقط لكل حساب. بعدها اختاري العادي أو المميز." : "Free trial is one generation per account. Then choose Standard or Premium."}</p></div>
        {status && <Card className="rounded-2xl p-4 text-sm"><div className="flex items-center gap-2 font-semibold"><BadgeCheck className="size-4 text-primary" />{ar ? `خطتك الحالية: ${planName(status.plan)}${status.plan !== "free" ? " (3 دروس يوميًا)" : " — محاولة واحدة فقط"}` : `Current plan: ${planName(status.plan)}${status.plan !== "free" ? " (3 lessons/day)" : " — one trial generation"}`}</div>{status.plan !== "free" && status.daysRemaining !== null && <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground"><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{ar ? `باقي ${status.daysRemaining} يوم على انتهاء اشتراكك` : `${status.daysRemaining} days remaining`}</span>{status.expiresAt && <span className="text-xs">{ar ? "ينتهي في " : "Expires on "}{new Date(status.expiresAt).toLocaleDateString(ar ? "ar-EG" : "en-GB")}</span>}</div>}</Card>}

        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card key={plan.id} className={`rounded-2xl p-5 transition-shadow hover:shadow-lg ${plan.id === "premium" ? "border-primary ring-1 ring-primary/30" : ""}`}>
              <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{ar ? plan.nameAr : plan.nameEn}</h2>{plan.id === "premium" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{ar ? "الأكثر مميزات" : "More features"}</span>}</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{ar ? "شهري" : "Monthly"}</p><p className="mt-1 text-2xl font-extrabold text-primary">${plan.monthlyPrice}</p><Button className="mt-2 w-full rounded-xl gradient-warm text-primary-foreground" onClick={() => window.open(waLink(plan, "monthly", status?.email), "_blank", "noopener")}><MessageCircle className="me-1 size-4" />{ar ? "اشترك" : "Subscribe"}</Button></div>
                <div className="rounded-xl border border-primary/40 bg-primary/5 p-3"><p className="text-xs text-muted-foreground">{ar ? "سنوي" : "Yearly"}</p><p className="mt-1 text-2xl font-extrabold text-primary">${plan.yearlyPrice}</p><Button className="mt-2 w-full rounded-xl gradient-warm text-primary-foreground" onClick={() => window.open(waLink(plan, "yearly", status?.email), "_blank", "noopener")}><MessageCircle className="me-1 size-4" />{ar ? "اشترك" : "Subscribe"}</Button></div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{ar ? plan.descAr : plan.descEn}</p>
            </Card>
          ))}
        </div>

        <Card className="rounded-2xl p-4 text-center text-sm"><p className="text-muted-foreground">{ar ? "بعد الدفع سنرسل لك كود تفعيل خاص بك يُستخدم لتفعيل الاشتراك على حسابك." : "After payment, you will receive an activation code for your account."}</p><Button variant="outline" className="mt-3 rounded-xl" onClick={() => window.open(waLink(PLANS[1], "monthly", status?.email, true), "_blank", "noopener")}><MessageCircle className="me-1 size-4" /> {ar ? "تواصل معنا" : "Contact us"}</Button></Card>

        <Card className="rounded-2xl p-5"><Label htmlFor="activation" className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" /> {ar ? "أدخل كود التفعيل" : "Enter activation code"}</Label><p className="mt-1 text-xs text-muted-foreground">{ar ? "الكود مرتبط بحسابك بعد التفعيل، ويمكن إيقافه في أي وقت." : "The code is bound to your account after activation and can be revoked."}</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input id="activation" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" className="rounded-xl font-mono tracking-widest" />{signedIn === false ? <Button className="rounded-xl" onClick={() => void navigate({ to: "/auth" })}>{ar ? "سجّل الدخول أولًا" : "Sign in first"}</Button> : <Button className="rounded-xl" onClick={() => void activate()} disabled={busy}>{busy ? (ar ? "جارٍ التفعيل…" : "Activating…") : ar ? "تفعيل" : "Activate"}</Button>}</div><p className="mt-3 text-xs text-muted-foreground">{ar ? "للحصول على كود: تواصل مع إدارة التطبيق بعد إتمام الدفع." : "To get a code: contact the app owner after payment."}</p></Card>
      </div>
    </div>
  );
}
