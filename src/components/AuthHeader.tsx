import { LogIn, Trophy, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { SubscriptionBadge } from "./SubscriptionBadge";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";
import { supabase } from "@/integrations/supabase/client";

export function AuthHeader() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [session, setSession] = useState<unknown | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch {
        setSession(null);
      } finally {
        setChecking(false);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <Button variant="ghost" size="sm" className="rounded-full text-xs" disabled>
        <User className="me-1 size-3.5" /> {ar ? "جارٍ التحقق..." : "Checking..."}
      </Button>
    );
  }

  if (!session) {
    return (
      <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
        <Link to="/auth">
          <LogIn className="me-1 size-3.5" />
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
        <Link to="/results">
          <Trophy className="me-1 size-3.5" />
          {ar ? "نتائج الطلبة" : "Student results"}
        </Link>
      </Button>
      <SubscriptionBadge />
      <SubscriptionStatusCard />
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
    </div>
  );
}