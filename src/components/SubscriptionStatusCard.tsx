import { Crown, CalendarDays, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, type SubscriptionStatus } from "@/lib/subscription.functions";

function toArabicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

export function SubscriptionStatusCard() {
  const fetchSub = useServerFn(getMySubscription);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const result = await fetchSub({ data: undefined } as never);
        setStatus(result);
      } catch {
        // Keep the card hidden if the subscription cannot be loaded.
      }
    })();
  }, [fetchSub]);

  if (!status) return null;

  const isFree = status.plan === "free";
  const planName = status.plan === "premium" ? "المميزة" : status.plan === "standard" ? "العادية" : "المجانية";
  const dailyLimit = status.plan === "premium" ? "٤ دروس يوميًا" : status.plan === "standard" ? "٢ درس يوميًا" : "محاولة واحدة مجانية";
  const days = status.daysRemaining ?? 0;
  const expiry = status.expiresAt ? formatExpiry(status.expiresAt) : "";
  const greeting = status.teacherName?.trim() ? `مرحبا ${status.teacherName.trim()}` : "مرحبا";

  return (
    <Card dir="rtl" className="mt-3 w-full rounded-3xl border-primary/15 bg-card/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-2xl gradient-warm text-primary-foreground">
            <Crown className="size-5" />
          </div>
          <div>
            <p className="text-base font-black text-foreground">{greeting}</p>
            <p className="mt-1 text-sm font-bold text-primary">خطتك اليومية: {dailyLimit}</p>
            {!isFree && <p className="mt-1 text-xs text-muted-foreground">خطتك الحالية: {planName}</p>}
          </div>
        </div>

        {!isFree && expiry && (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">
            <CalendarDays className="size-4" />
            <span>ينتهي في {toArabicDigits(expiry)}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkles className="size-3.5" />
        <span>{isFree ? "التجربة المجانية متاحة مرة واحدة فقط." : `متاح لك ${toArabicDigits(status.remainingToday)} من المحاولات اليوم.`}</span>
      </div>
    </Card>
  );
}