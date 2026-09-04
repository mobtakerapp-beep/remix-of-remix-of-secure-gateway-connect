import { BookOpen, Crown, Home, LogOut, Shield, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { getMySubscription, saveProfile, type SubscriptionStatus } from "@/lib/subscription.functions";
import { isAdminClient } from "@/lib/admin-client";
import { setIsPremium } from "@/lib/premium-flag";

export function SubscriptionBadge({ onLimitReached }: { onLimitReached?: () => void }) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const fetchSub = useServerFn(getMySubscription);
  const saveProfileFn = useServerFn(saveProfile);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [teacherName, setTeacherName] = useState("");
  const [school, setSchool] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);
        const s = await fetchSub({ data: undefined } as never);
        setStatus(s);
        setIsPremium(s.plan !== "free" && s.status === "active");
        setTeacherName(s.teacherName);
        setSchool(s.school);
        setIsAdmin(await isAdminClient());
      } catch {
        // not logged in or error — ignore
      }
    })();
  }, [fetchSub]);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveProfileFn({ data: { teacherName, school } });
      toast.success(ar ? "تم حفظ البيانات" : "Profile saved");
      setEditing(false);
    } catch {
      toast.error(ar ? "فشل الحفظ" : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!signedIn) return null;

  const isFree = !status || status.plan === "free";
  const planLabel = status?.plan === "premium" ? (ar ? "مميز" : "Premium") : status?.plan === "standard" ? (ar ? "عادي" : "Standard") : (ar ? "مجاني" : "Free");
  const dailyLimit = status?.plan === "premium" ? "٤ دروس يوميًا" : status?.plan === "standard" ? "٢ درس يوميًا" : "درس واحد فقط";
  const greeting = teacherName.trim() ? `مرحبا ${teacherName.trim()}` : "مرحبا";

  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
        <Link to="/results">
          <TrophyIcon />
          {ar ? "نتائج الطلبة" : "Student results"}
        </Link>
      </Button>
      <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${isFree ? "bg-secondary text-secondary-foreground" : "gradient-warm text-primary-foreground"}`}>
        {isFree ? <Zap className="size-3.5" /> : <Crown className="size-3.5" />}
        {isFree
          ? status
            ? ar ? `مجاني — باقي ${status.remainingToday} محاولة` : `Free — ${status.remainingToday} left`
            : ar ? "حسابي" : "My account"
          : ar
            ? `اشتراك ${planLabel} — ${status.remainingToday} دروس متبقية اليوم`
            : `${planLabel} — ${status.remainingToday} lessons left today`}
      </div>

      <Button variant="ghost" size="sm" className="rounded-full text-xs" onClick={() => setEditing(!editing)}>
        <Sparkles className="me-1 size-3.5" /> {ar ? "بياناتي" : "My profile"}
      </Button>

      <Button asChild size="sm" className="rounded-full gradient-warm text-xs text-primary-foreground">
        <Link to="/subscribe">
          <Crown className="me-1 size-3.5" />
          {isFree ? (ar ? "اشترك الآن" : "Subscribe") : ar ? "إدارة الاشتراك" : "Manage plan"}
        </Link>
      </Button>

      <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
        <Link to="/my-lessons"><BookOpen className="me-1 size-3.5" /> {ar ? "دروسي المحفوظة" : "My lessons"}</Link>
      </Button>

      {isAdmin && (
        <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
          <Link to="/admin"><Shield className="me-1 size-3.5" /> {ar ? "لوحة التحكم" : "Admin"}</Link>
        </Button>
      )}

      <Button variant="ghost" size="sm" className="rounded-full text-xs text-muted-foreground" onClick={() => void logout()}>
        <LogOut className="me-1 size-3.5" /> {ar ? "خروج" : "Sign out"}
      </Button>

      <div dir="rtl" className="w-full rounded-3xl border border-primary/15 bg-card/90 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl gradient-warm text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <p className="text-base font-black text-foreground">{greeting}</p>
            <p className="mt-1 text-sm font-bold text-primary">خطتك اليومية: {dailyLimit}</p>
          </div>
        </div>
      </div>

      <div dir="rtl" className="w-full overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-secondary/70 to-accent/20 shadow-sm">
        <div className="px-4 pb-3 pt-4 text-center">
          <div className="text-lg font-black text-primary sm:text-xl">🎁 عرض سنوي لفترة محدودة</div>
          <p className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
            وفّر أكثر واستمتع بمزايا ملخصي طوال العام
          </p>
        </div>
        <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2 sm:px-4">
          <div className="rounded-2xl border border-primary/15 bg-background/70 p-4 text-center shadow-sm">
            <div className="text-sm font-black text-primary sm:text-base">💙 الخطة العادية</div>
            <div className="mt-1 text-xl font-black text-foreground">٧٠$ <span className="text-sm font-semibold text-muted-foreground">سنويًا</span></div>
            <div className="mt-1 text-xs text-muted-foreground line-through">بدل ٨٤$</div>
            <div className="mt-2 text-sm font-bold text-primary">📚 ٢ درس يوميًا</div>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-background/70 p-4 text-center shadow-sm">
            <div className="text-sm font-black text-primary sm:text-base">💜 الخطة المميزة</div>
            <div className="mt-1 text-xl font-black text-foreground">١٠٠$ <span className="text-sm font-semibold text-muted-foreground">سنويًا</span></div>
            <div className="mt-1 text-xs text-muted-foreground line-through">بدل ١٨٠$</div>
            <div className="mt-2 text-sm font-bold text-primary">✨ ٤ دروس + فيديو واحد يوميًا</div>
          </div>
        </div>
        <div className="border-t border-primary/10 px-4 py-2.5 text-center text-xs font-bold text-muted-foreground sm:text-sm">
          🔥 عرض خاص لفترة محدودة — اختر الخطة المناسبة لك
        </div>
      </div>

      {editing && (
        <div className="mt-2 w-full rounded-2xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sub-teacher">{t.teacherName}</Label>
              <Input id="sub-teacher" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder={t.teacherPlaceholder} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-school">{ar ? "المدرسة" : "School"}</Label>
              <Input id="sub-school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder={ar ? "اسم المدرسة" : "School name"} className="rounded-xl" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={saving}>{saving ? (ar ? "جارٍ الحفظ…" : "Saving…") : ar ? "حفظ" : "Save"}</Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(false)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button asChild size="sm" variant="outline" className="rounded-full"><Link to="/"><Home className="me-1 size-3.5" /> {ar ? "الرئيسية" : "Home"}</Link></Button>
          </div>
          {isFree && <p className="mt-3 rounded-xl bg-amber/10 p-2 text-xs text-amber-foreground">{ar ? "التجربة المجانية مرة واحدة فقط. اختاري العادي أو المميز من صفحة الاشتراك." : "The free trial is one generation only. Choose Standard or Premium on the subscribe page."}</p>}
        </div>
      )}
    </div>
  );
}

function TrophyIcon() {
  return <span className="me-1 inline-block text-sm">🏆</span>;
}