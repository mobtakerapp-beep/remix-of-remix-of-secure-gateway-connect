import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, Home, Loader2, Plus, Search, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateCodes, adminDeleteCode, adminListCodes, amIAdmin, type CodeRow } from "@/lib/access.functions";
import { createCodesClient, deleteCodeClient, isAdminClient, listCodesClient } from "@/lib/admin-client";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم — ملخصي" },
      { name: "description", content: "إدارة أكواد التفعيل والاشتراكات في ملخصي." },
    ],
  }),
  component: AdminPage,
});

function isGift(note: string | null | undefined) {
  return (note ?? "").trim().toUpperCase().startsWith("[GIFT]");
}

function planLabel(plan: string, note: string | null | undefined, ar: boolean) {
  if (isGift(note)) return ar ? "هدية" : "Gift";
  if (plan === "premium" || plan === "yearly") return ar ? "مميز" : "Premium";
  return ar ? "عادي" : "Standard";
}

function periodLabel(plan: string, days: number, note: string | null | undefined, ar: boolean) {
  if (isGift(note)) return ar ? `${days} يوم هدية` : `${days}-day Gift`;
  return days >= 365 ? (ar ? "سنوي" : "Yearly") : (ar ? "شهري" : "Monthly");
}

function dateLabel(value: string, ar: boolean) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(ar ? "ar-EG" : "en-GB");
}

function AdminPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const checkAdmin = useServerFn(amIAdmin);
  const listCodes = useServerFn(adminListCodes);
  const createCodes = useServerFn(adminCreateCodes);
  const deleteCode = useServerFn(adminDeleteCode);

  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [count, setCount] = useState(1);
  const [codeKind, setCodeKind] = useState<"paid" | "gift">("paid");
  const [plan, setPlan] = useState<"standard" | "premium">("standard");
  const [durationDays, setDurationDays] = useState(30);
  const [giftDays, setGiftDays] = useState(8);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const refresh = async () => {
    try {
      const data = await listCodes({ data: undefined } as never).catch(() => listCodesClient());
      setRows(data);
    } catch {
      toast.error(ar ? "تعذر تحميل الأكواد" : "Could not load codes");
    }
  };

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      let admin = false;
      try { admin = Boolean((await checkAdmin({ data: undefined } as never))?.isAdmin); } catch {}
      if (!admin) {
        try { admin = await isAdminClient(); } catch {}
      }
      setAllowed(admin);
      if (admin) await refresh();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPeriod = codeKind === "gift" ? "gift" : `${plan}-${durationDays >= 365 ? "yearly" : "monthly"}`;

  const choosePeriod = (value: string) => {
    if (value === "standard-monthly") { setPlan("standard"); setDurationDays(30); }
    else if (value === "standard-yearly") { setPlan("standard"); setDurationDays(365); }
    else if (value === "premium-monthly") { setPlan("premium"); setDurationDays(30); }
    else if (value === "premium-yearly") { setPlan("premium"); setDurationDays(365); }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const days = codeKind === "gift" ? Math.max(1, Math.min(3650, giftDays)) : durationDays;
      const selectedPlan = codeKind === "gift" ? "standard" : plan;
      const giftPrefix = codeKind === "gift" ? "[GIFT] " : "";
      const result = await createCodes({ data: { count: Math.max(1, Math.min(50, count)), plan: selectedPlan, durationDays: days, maxUses: codeKind === "gift" ? 1 : Math.max(1, Math.min(1000, maxUses)), note: `${giftPrefix}${note}`.trim() || undefined } }).catch(() => createCodesClient({ count: Math.max(1, Math.min(50, count)), plan: selectedPlan, durationDays: days, maxUses: codeKind === "gift" ? 1 : Math.max(1, Math.min(1000, maxUses)), note: `${giftPrefix}${note}`.trim() || undefined }));
      if (result.codes.length) {
        await navigator.clipboard.writeText(result.codes.join("\n")).catch(() => undefined);
        toast.success(ar ? `تم توليد ${result.codes.length} كود ونسخهم` : `Generated and copied ${result.codes.length} codes`);
      }
      setNote("");
      await refresh();
    } catch {
      toast.error(ar ? "فشل توليد الأكواد" : "Failed to generate codes");
    } finally {
      setBusy(false);
    }
  };

  const removeCode = async (row: CodeRow) => {
    const ok = window.confirm(ar ? `هل تريدين حذف الكود ${row.code} نهائيًا؟` : `Delete code ${row.code} permanently?`);
    if (!ok) return;
    setBusy(true);
    try {
      try { await deleteCode({ data: { id: row.id } }); }
      catch { await deleteCodeClient(row.id); }
      toast.success(ar ? "تم حذف الكود" : "Code deleted");
      await refresh();
    } catch {
      toast.error(ar ? "فشل حذف الكود" : "Failed to delete code");
    } finally {
      setBusy(false);
    }
  };

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.code.toLowerCase().includes(q) || r.plan.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q) || planLabel(r.plan, r.note, ar).toLowerCase().includes(q);
  });

  const exportCsv = () => {
    const header = ar ? "الكود,الخطة,الفترة,الأيام,الاستخدام,الحد,الملاحظة,الحالة,تاريخ الإنشاء" : "Code,Plan,Period,Days,Uses,Max,Note,Status,Created";
    const lines = filtered.map((r) => [r.code, planLabel(r.plan, r.note, ar), periodLabel(r.plan, r.durationDays, r.note, ar), r.durationDays, r.usedCount, r.maxUses, `"${(r.note ?? "").replace(/"/g, '""')}"`, r.active ? (ar ? "فعّال" : "Active") : (ar ? "موقوف" : "Disabled"), dateLabel(r.createdAt, ar)].join(","));
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "malakhasi-activation-codes.csv"; a.click(); URL.revokeObjectURL(url);
  };

  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="size-6 animate-spin text-primary" /></main>;
  if (!allowed) return <main className="flex min-h-screen items-center justify-center bg-background p-4"><Card className="max-w-md rounded-3xl p-8 text-center"><Shield className="mx-auto size-10 text-muted-foreground" /><h1 className="mt-3 font-display text-xl font-extrabold">{ar ? "هذه الصفحة للمشرف فقط" : "Admins only"}</h1><Button className="mt-5 rounded-full" onClick={() => navigate({ to: "/" })}>{ar ? "العودة للرئيسية" : "Back home"}</Button></Card></main>;

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8" dir={ar ? "rtl" : "ltr"}>
      <Toaster position="top-center" />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3"><h1 className="font-display text-2xl font-extrabold text-primary"><Shield className="me-2 inline size-6" />{ar ? "إدارة أكواد التفعيل" : "Activation codes"}</h1><Link to="/" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted-foreground"><Home className="size-4" />{ar ? "الرئيسية" : "Home"}</Link></div>

        <Card className="rounded-3xl border-primary/30 bg-primary/5 p-5">
          <h2 className="font-display text-lg font-bold">{ar ? "توليد سريع" : "Quick generate"}</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Button className="rounded-full gradient-hero text-primary-foreground" disabled={busy} onClick={() => { setPlan("standard"); setDurationDays(30); setCodeKind("paid"); void generate(); }}>{ar ? "شهري عادي — $7" : "Monthly Standard — $7"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { setPlan("premium"); setDurationDays(30); setCodeKind("paid"); void generate(); }}>{ar ? "شهري مميز — $15" : "Monthly Premium — $15"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { setPlan("standard"); setDurationDays(365); setCodeKind("paid"); void generate(); }}>{ar ? "سنوي عادي — $50" : "Yearly Standard — $50"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { setPlan("premium"); setDurationDays(365); setCodeKind("paid"); void generate(); }}>{ar ? "سنوي مميز — $100" : "Yearly Premium — $100"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { setCodeKind("gift"); void generate(); }}><Plus className="me-2 size-4" />{ar ? "هدية" : "Gift"}</Button>
          </div>
        </Card>

        <Card className="rounded-3xl p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5"><Label>{ar ? "نوع الكود" : "Code type"}</Label><select value={codeKind} onChange={(e) => setCodeKind(e.target.value as "paid" | "gift")} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="paid">{ar ? "اشتراك مدفوع" : "Paid subscription"}</option><option value="gift">{ar ? "هدية" : "Gift"}</option></select></div>
            <div className="space-y-1.5"><Label>{ar ? "الخطة والفترة" : "Plan & period"}</Label><select value={selectedPeriod} disabled={codeKind === "gift"} onChange={(e) => choosePeriod(e.target.value)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="standard-monthly">{ar ? "عادي شهري — $7" : "Standard Monthly — $7"}</option><option value="standard-yearly">{ar ? "عادي سنوي — $50" : "Standard Yearly — $50"}</option><option value="premium-monthly">{ar ? "مميز شهري — $15" : "Premium Monthly — $15"}</option><option value="premium-yearly">{ar ? "مميز سنوي — $100" : "Premium Yearly — $100"}</option></select></div>
            <div className="space-y-1.5"><Label>{ar ? "المدة (يوم)" : "Duration (days)"}</Label><Input type="number" min={1} max={3650} value={codeKind === "gift" ? giftDays : durationDays} onChange={(e) => codeKind === "gift" ? setGiftDays(Number(e.target.value)) : setDurationDays(Number(e.target.value))} className="rounded-xl" /></div>
            <div className="space-y-1.5"><Label>{ar ? "عدد الاستخدامات" : "Uses per code"}</Label><Input type="number" min={1} max={1000} disabled={codeKind === "gift"} value={codeKind === "gift" ? 1 : maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="rounded-xl" /></div>
            <div className="space-y-1.5"><Label>{ar ? "عدد الأكواد" : "Count"}</Label><Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-xl" /></div>
          </div>
          <div className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl" placeholder={ar ? "ملاحظة اختيارية" : "Optional note"} /></div>
          <Button className="mt-4 rounded-full gradient-hero text-primary-foreground" onClick={() => void generate()} disabled={busy}>{busy ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}{ar ? "توليد الأكواد" : "Generate codes"}</Button>
        </Card>

        <Card className="overflow-hidden rounded-3xl p-2">
          <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ar ? "ابحث بالكود أو الخطة" : "Search codes"} className="rounded-full ps-9" /></div><Button variant="outline" className="rounded-full" onClick={exportCsv} disabled={!filtered.length}><Download className="me-1 size-4" />CSV</Button></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-muted-foreground"><tr><th className="p-3 text-start">{ar ? "الكود" : "Code"}</th><th className="p-3 text-start">{ar ? "الخطة" : "Plan"}</th><th className="p-3 text-start">{ar ? "الفترة" : "Period"}</th><th className="p-3 text-start">{ar ? "الأيام" : "Days"}</th><th className="p-3 text-start">{ar ? "الاستخدام" : "Uses"}</th><th className="p-3 text-start">{ar ? "الحالة" : "Status"}</th><th className="p-3 text-end">{ar ? "إجراءات" : "Actions"}</th></tr></thead><tbody>{filtered.map((r) => <tr key={r.id} className="border-t border-border/60"><td className="p-3 font-mono font-bold">{r.code}</td><td className="p-3">{planLabel(r.plan, r.note, ar)}</td><td className="p-3">{periodLabel(r.plan, r.durationDays, r.note, ar)}</td><td className="p-3">{r.durationDays}</td><td className="p-3">{r.usedCount}/{r.maxUses}</td><td className="p-3">{r.active ? (ar ? "فعّال" : "Active") : (ar ? "موقوف" : "Disabled")}</td><td className="p-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" className="rounded-full" onClick={() => void navigator.clipboard.writeText(r.code).then(() => toast.success(ar ? "تم النسخ" : "Copied")).catch(() => undefined)}><Copy className="size-3.5" /></Button><Button size="sm" variant="outline" className="rounded-full text-destructive hover:text-destructive" disabled={busy} onClick={() => void removeCode(r)}><Trash2 className="size-3.5" /></Button></div></td></tr>)}</tbody></table></div>
          {!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">{ar ? "لا توجد أكواد" : "No codes found"}</p>}
        </Card>
      </div>
    </main>
  );
}
