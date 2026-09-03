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

  if (!status || status.plan === "free") return null;

  const planName = status.plan === "monthly" ? "مميزة الشهرية" : "مميزة";
  const days = status.daysRemaining ?? 0;
  const expiry = status.expiresAt ? formatExpiry(status.expiresAt) : "";

  return (
    <Card
      dir="rtl"
      className="mt-3 w-full rounded-3xl border-primary/15 bg-card/90 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-2xl gradient-warm text-primary-foreground">
            <Crown className="size-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">
              خطتك الحالية: {planName} ({toArabicDigits(3)} دروس يوميًا)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              باقي {toArabicDigits(days)} يوم على انتهاء اشتراكك
            </p>
          </div>
        </div>

        {expiry && (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">
            <CalendarDays className="size-4" />
            <span>ينتهي في {toArabicDigits(expiry)}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkles className="size-3.5" />
        <span>يمكنك إنشاء ٣ دروس يوميًا طوال مدة الاشتراك.</span>
      </div>
    </Card>
  );
}
