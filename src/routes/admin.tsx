import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, FileSpreadsheet, Home, Loader2, MessageCircle, Plus, RefreshCw, Search, Shield, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateCodes, adminListCodes, adminListRedemptions, adminSetCodeActive, amIAdmin, type CodeRow, type RedemptionRow } from "@/lib/access.functions";
import { createCodesClient, isAdminClient, listCodesClient, listRedemptionsClient, setCodeActiveClient } from "@/lib/admin-client";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم — ملخصي" },
      { name: "description", content: "إدارة أكواد التفعيل والاشتراكات في ملخصي." },
      { property: "og:title", content: "لوحة تحكم المشرف" },
      { property: "og:description", content: "توليد وإدارة أكواد تفعيل الاشتراك." },
    ],
  }),
  component: AdminPage,
});

function isActive(r: RedemptionRow) {
  if (!r.subscriptionExpiresAt) return true;
  const end = new Date(r.subscriptionExpiresAt);
  if (Number.isNaN(end.getTime())) return true;
  end.setHours(23, 59, 59, 999);
  return end.getTime() >= Date.now();
}

function daysLeft(r: RedemptionRow) {
  if (!r.subscriptionExpiresAt) return null;
  const ms = new Date(r.subscriptionExpiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86400000));
}

function fmtDate(value: string | null, ar: boolean) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(ar ? "ar-EG" : "en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function isGiftNote(note: string | null | undefined) {
  return (note ?? "").trim().toUpperCase().startsWith("[GIFT]");
}

function displayPlan(plan: string, note: string | null | undefined, ar: boolean) {
  if (isGiftNote(note)) return ar ? "هدية" : "Gift";
  if (plan === "premium") return ar ? "مميز" : "Premium";
  if (plan === "standard") return ar ? "عادي" : "Standard";
  if (plan === "monthly") return ar ? "عادي" : "Standard";
  if (plan === "yearly") return ar ? "مميز" : "Premium";
  return plan;
}

function codeMessage(code: string, plan: string, days: number, ar: boolean, name?: string | null, gift = false) {
  const planLabel = gift ? (ar ? "هدية" : "Gift") : plan === "premium" ? (ar ? "مميز" : "Premium") : (ar ? "عادي" : "Standard");
  if (ar) {
    return `${name ? `أهلاً ${name}،\n` : ""}كود تفعيل اشتراكك في «ملخصي»:\n${code}\n\nالخطة: ${planLabel} (${days} يوم)${gift ? "\nالهدية تشمل النص والصور فقط." : ""}\nطريقة التفعيل: سجّل دخولك، اذهب لصفحة الاشتراك وأدخل الكود.`;
  }
  return `${name ? `Hi ${name},\n` : ""}Your activation code for Malakhasi:\n${code}\n\nPlan: ${planLabel} (${days} days)${gift ? "\nGift access includes text and images only." : ""}\nSign in, open the subscribe page and enter the code.`;
}

function AdminPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const checkAdmin = useServerFn(amIAdmin);
  const listCodes = useServerFn(adminListCodes);
  const listRedemptions = useServerFn(adminListRedemptions);
  const createCodes = useServerFn(adminCreateCodes);
  const setActive = useServerFn(adminSetCodeActive);

  const listCodesSafe = async () => {
    try { return await listCodes({ data: undefined } as never); }
    catch { return await listCodesClient(); }
  };
  const listRedemptionsSafe = async () => {
    try { return await listRedemptions({ data: undefined } as never); }
    catch { return await listRedemptionsClient(); }
  };
  const createCodesSafe = async (arg: { data: { count: number; plan: "standard" | "premium"; durationDays: number; maxUses: number; note?: string; notes?: string[] } }) => {
    try { return await createCodes(arg); }
    catch { return await createCodesClient(arg.data); }
  };
  const setActiveSafe = async (id: string, active: boolean) => {
    try { return await setActive({ data: { id, active } }); }
    catch { return await setCodeActiveClient(id, active); }
  };

  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [count, setCount] = useState(5);
  const [codeKind, setCodeKind] = useState<"paid" | "gift">("paid");
  const [plan, setPlan] = useState<"standard" | "premium">("standard");
  const [durationDays, setDurationDays] = useState(30);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>(Array.from({ length: 5 }, () => ""));
  const [giftDays, setGiftDays] = useState(8);
  const [busy, setBusy] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waName, setWaName] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [redemptionSearch, setRedemptionSearch] = useState("");
  const [redemptionStatus, setRedemptionStatus] = useState<"all" | "active" | "expired">("all");

  const refresh = async () => {
    try {
      setRows(await listCodesSafe());
      setRedemptions(await listRedemptionsSafe());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { navigate({ to: "/auth" }); return; }
      let admin = false;
      try { admin = Boolean((await checkAdmin({ data: undefined } as never))?.isAdmin); } catch { admin = false; }
      try {
        if (!admin) admin = await isAdminClient();
        setAllowed(admin);
        if (admin) await refresh();
      } catch { setAllowed(admin); }
      finally { setReady(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = rows.filter((r) => {
    const q = codeSearch.trim().toLowerCase();
    return !q || r.code.toLowerCase().includes(q) || r.plan.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q) || displayPlan(r.plan, r.note, ar).toLowerCase().includes(q);
  });

  const filteredRedemptions = redemptions.filter((r) => {
    const active = isActive(r);
    if (redemptionStatus === "active" && !active) return false;
    if (redemptionStatus === "expired" && active) return false;
    const q = redemptionSearch.trim().toLowerCase();
    return !q || r.code.toLowerCase().includes(q) || (r.userEmail ?? "").toLowerCase().includes(q) || r.plan.toLowerCase().includes(q) || displayPlan(r.plan, r.note, ar).toLowerCase().includes(q);
  });

  function downloadCsv(content: string, fileName: string) {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const exportCodesCsv = () => {
    const headers = ar ? ["الكود", "الخطة", "الأيام", "الاستخدام", "الحد", "الملاحظة", "الحالة", "تاريخ الإنشاء"] : ["Code", "Plan", "Days", "Uses", "Max", "Note", "Status", "Created at"];
    const lines = filteredRows.map((r) => [r.code, displayPlan(r.plan, r.note, ar), r.durationDays, r.usedCount, r.maxUses, `"${(r.note ?? "").replace(/"/g, '""')}"`, r.active ? (ar ? "فعّال" : "Active") : (ar ? "موقوف" : "Disabled"), fmtDate(r.createdAt, ar)].join(","));
    downloadCsv([headers.join(","), ...lines].join("\n"), "activation-codes.csv");
  };

  const exportRedemptionsCsv = () => {
    const headers = ar ? ["الكود", "الخطة", "بريد العميل", "تاريخ الاستخدام", "تاريخ الانتهاء", "الأيام المتبقية", "الحالة"] : ["Code", "Plan", "Customer", "Redeemed on", "Expires on", "Days left", "Status"];
    const lines = filteredRedemptions.map((r) => [r.code, displayPlan(r.plan, r.note, ar), r.userEmail ?? "", fmtDate(r.redeemedAt, ar), fmtDate(r.subscriptionExpiresAt, ar), String(daysLeft(r) ?? ""), isActive(r) ? (ar ? "نشط" : "Active") : (ar ? "منتهي" : "Expired")].join(","));
    downloadCsv([headers.join(","), ...lines].join("\n"), "subscribers.csv");
  };

  const generate = async () => {
    setBusy(true);
    try {
      const effectivePlan = codeKind === "gift" ? "standard" : plan;
      const effectiveDays = codeKind === "gift" ? Math.max(1, Math.min(3650, giftDays)) : durationDays;
      const prefix = codeKind === "gift" ? "[GIFT] " : "";
      const perCode = Array.from({ length: count }, (_u, i) => `${prefix}${notes[i] ?? ""}`.trim());
      const res = await createCodesSafe({ data: { count, plan: effectivePlan, durationDays: effectiveDays, maxUses: codeKind === "gift" ? 1 : maxUses, note: `${prefix}${note}`.trim() || undefined, notes: perCode } });
      toast.success(ar ? `تم توليد ${res.codes.length} كود` : `Generated ${res.codes.length} codes`);
      setNote(""); setNotes(Array.from({ length: count }, () => "")); await refresh();
    } catch { toast.error(ar ? "فشل التوليد" : "Failed to generate"); }
    finally { setBusy(false); }
  };

  const openWhatsApp = (code: string, planValue: string, days: number, phone: string, name?: string | null, gift = false) => {
    window.open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(codeMessage(code, planValue, days, ar, name, gift))}`, "_blank", "noopener");
  };

  const quick = async (quickPlan: "standard" | "premium", quickDays: number) => {
    setBusy(true);
    try {
      const name = waName.trim();
      const res = await createCodesSafe({ data: { count: 1, plan: quickPlan, durationDays: quickDays, maxUses: 1, note: name || undefined } });
      const created = res.codes[0];
      if (created) {
        await navigator.clipboard.writeText(created).catch(() => undefined);
        toast.success(ar ? `تم توليد الكود: ${created}` : `Code created: ${created}`);
        if (waPhone.trim()) openWhatsApp(created, quickPlan, quickDays, waPhone, name || null);
      }
      setWaName(""); setWaPhone(""); await refresh();
    } catch { toast.error(ar ? "فشل التوليد" : "Failed to generate"); }
    finally { setBusy(false); }
  };

  const quickGift = async () => {
    setBusy(true);
    try {
      const days = Math.max(1, Math.min(3650, giftDays));
      const name = waName.trim();
      const res = await createCodesSafe({ data: { count: 1, plan: "standard", durationDays: days, maxUses: 1, note: `[GIFT] ${name}`.trim() } });
      const created = res.codes[0];
      if (created) {
        await navigator.clipboard.writeText(created).catch(() => undefined);
        toast.success(ar ? `تم توليد كود الهدية: ${created}` : `Gift code created: ${created}`);
        if (waPhone.trim()) openWhatsApp(created, "standard", days, waPhone, name || null, true);
      }
      setWaName(""); setWaPhone(""); await refresh();
    } catch { toast.error(ar ? "فشل توليد الهدية" : "Failed to create gift"); }
    finally { setBusy(false); }
  };

  const renew = async (r: RedemptionRow) => {
    setBusy(true);
    try {
      if (isGiftNote(r.note)) {
        toast.info(ar ? "كود الهدية لا يتجدد كاشتراك مدفوع. أنشئي هدية جديدة بالمدة المطلوبة." : "Gift codes are not renewed as paid subscriptions. Create a new gift with the required duration.");
        return;
      }
      const renewalPlan: "standard" | "premium" = r.plan === "premium" ? "premium" : "standard";
      const renewalDays = renewalPlan === "premium" ? 30 : 30;
      const label = r.note || r.userEmail || "";
      const res = await createCodesSafe({ data: { count: 1, plan: renewalPlan, durationDays: renewalDays, maxUses: 1, note: ar ? `تجديد — ${label}` : `Renewal — ${label}` } });
      const created = res.codes[0];
      if (created) {
        await navigator.clipboard.writeText(created).catch(() => undefined);
        toast.success(ar ? `كود تجديد جديد: ${created}` : `New renewal code: ${created}`);
      }
      await refresh();
    } catch { toast.error(ar ? "فشل توليد كود التجديد" : "Failed to create renewal code"); }
    finally { setBusy(false); }
  };

  const toggle = async (row: CodeRow) => { await setActiveSafe(row.id, !row.active); await refresh(); };

  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="size-6 animate-spin text-primary" /></main>;
  if (!allowed) return <main className="flex min-h-screen items-center justify-center bg-background p-4"><Card className="max-w-md rounded-3xl p-8 text-center"><Shield className="mx-auto size-10 text-muted-foreground" /><h1 className="mt-3 font-display text-xl font-extrabold">{ar ? "هذه الصفحة للمشرف فقط" : "Admins only"}</h1><p className="mt-2 text-sm text-muted-foreground">{ar ? "حسابك لا يملك صلاحية إدارة أكواد التفعيل." : "Your account does not have permission to manage activation codes."}</p><Button className="mt-5 rounded-full" onClick={() => navigate({ to: "/" })}>{ar ? "العودة للرئيسية" : "Back home"}</Button></Card></main>;

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8" dir={ar ? "rtl" : "ltr"}>
      <Toaster position="top-center" />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-3"><h1 className="font-display text-2xl font-extrabold text-primary"><Shield className="me-2 inline size-6" />{ar ? "إدارة أكواد التفعيل" : "Activation codes"}</h1><Link to="/" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-accent"><Home className="size-4" /><span className="hidden sm:inline">{ar ? "الرئيسية" : "Home"}</span></Link></div>

        <Card className="rounded-3xl border-primary/30 bg-primary/5 p-5">
          <h2 className="font-display text-lg font-bold">{ar ? "توليد سريع" : "Quick generate"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{ar ? "اختاري نوع الكود والخطة. كل كود سريع يستخدم مرة واحدة فقط." : "Choose the code type and plan. Quick codes are single-use."}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>{ar ? "اسم العميل" : "Customer name"}</Label><Input value={waName} onChange={(e) => setWaName(e.target.value)} placeholder={ar ? "مثال: أ. سارة" : "e.g. Sarah"} className="rounded-xl" /></div><div className="space-y-1.5"><Label>{ar ? "رقم الواتساب (اختياري)" : "WhatsApp number (optional)"}</Label><Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="9689xxxxxxx" inputMode="tel" className="rounded-xl" /></div></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Button className="rounded-full gradient-hero text-primary-foreground" disabled={busy} onClick={() => void quick("standard", 30)}><Plus className="me-2 size-4" />{ar ? "شهري عادي" : "Monthly Standard"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => void quick("premium", 30)}><Plus className="me-2 size-4" />{ar ? "شهري مميز" : "Monthly Premium"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => void quick("standard", 365)}><Plus className="me-2 size-4" />{ar ? "سنوي عادي" : "Yearly Standard"}</Button>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => void quick("premium", 365)}><Plus className="me-2 size-4" />{ar ? "سنوي مميز" : "Yearly Premium"}</Button>
            <div className="flex gap-2"><Input type="number" min={1} max={3650} value={giftDays} onChange={(e) => setGiftDays(Number(e.target.value))} className="rounded-full" /><Button variant="outline" className="rounded-full" disabled={busy} onClick={() => void quickGift()}><Plus className="me-2 size-4" />{ar ? "هدية" : "Gift"}</Button></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{ar ? "الهدية: عدد أيام تختاريه، وتسمح بالنص والصور فقط. PDF والفيديو مقفولين." : "Gift: choose any number of days; text and images only. PDF and video are locked."}</p>
        </Card>

        <Card className="rounded-3xl p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5"><Label>{ar ? "نوع الكود" : "Code type"}</Label><select value={codeKind} onChange={(e) => setCodeKind(e.target.value as "paid" | "gift")} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="paid">{ar ? "اشتراك مدفوع" : "Paid subscription"}</option><option value="gift">{ar ? "هدية" : "Gift"}</option></select></div>
            <div className="space-y-1.5"><Label>{ar ? "الخطة" : "Plan"}</Label><select value={plan} disabled={codeKind === "gift"} onChange={(e) => setPlan(e.target.value as "standard" | "premium")} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="standard">{ar ? "عادي — $7" : "Standard — $7"}</option><option value="premium">{ar ? "مميز — $15" : "Premium — $15"}</option></select></div>
            <div className="space-y-1.5"><Label>{ar ? "المدة (يوم)" : "Duration (days)"}</Label><Input type="number" min={1} max={3650} value={codeKind === "gift" ? giftDays : durationDays} onChange={(e) => codeKind === "gift" ? setGiftDays(Number(e.target.value)) : setDurationDays(Number(e.target.value))} className="rounded-xl" /></div>
            <div className="space-y-1.5"><Label>{ar ? "عدد مرات الاستخدام" : "Uses per code"}</Label><Input type="number" min={1} max={1000} disabled={codeKind === "gift"} value={codeKind === "gift" ? 1 : maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="rounded-xl" /></div>
          </div>
          <div className="mt-4 space-y-2"><Label>{ar ? "اسم صاحب كل كود" : "Name for each code"}</Label><div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: Math.max(1, Math.min(count || 1, 50)) }, (_u, i) => <Input key={i} value={notes[i] ?? ""} onChange={(e) => setNotes((prev) => { const next = [...prev]; while (next.length <= i) next.push(""); next[i] = e.target.value; return next; })} className="rounded-xl" placeholder={ar ? `اسم صاحب الكود ${i + 1}` : `Name for code ${i + 1}`} />)}</div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl" placeholder={ar ? "ملاحظة اختيارية" : "Optional note"} /><Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-xl" placeholder={ar ? "عدد الأكواد" : "Count"} /></div>
          <Button className="mt-4 rounded-full gradient-hero text-primary-foreground" onClick={() => void generate()} disabled={busy}>{busy ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}{ar ? "توليد الأكواد" : "Generate codes"}</Button>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "إجمالي الأكواد" : "Total codes"}</p><p className="mt-1 font-display text-2xl font-extrabold text-primary">{rows.length}</p></Card><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "أكواد فعّالة" : "Active codes"}</p><p className="mt-1 font-display text-2xl font-extrabold text-emerald">{rows.filter((r) => r.active).length}</p></Card><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "أكواد مستخدمة" : "Used codes"}</p><p className="mt-1 font-display text-2xl font-extrabold text-amber">{rows.filter((r) => r.usedCount > 0).length}</p></Card><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "إجمالي الاستخدامات" : "Total redemptions"}</p><p className="mt-1 font-display text-2xl font-extrabold text-primary">{redemptions.length}</p></Card><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "مشتركون نشطون" : "Active subscribers"}</p><p className="mt-1 font-display text-2xl font-extrabold text-emerald">{redemptions.filter(isActive).length}</p></Card><Card className="rounded-3xl p-4"><p className="text-xs text-muted-foreground">{ar ? "اشتراكات منتهية" : "Expired subscriptions"}</p><p className="mt-1 font-display text-2xl font-extrabold text-destructive">{redemptions.filter((r) => !isActive(r)).length}</p></Card></div>

        <Card className="overflow-x-auto rounded-3xl p-2"><div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-display text-lg font-bold"><FileSpreadsheet className="me-2 inline size-5 text-primary" />{ar ? "الأكواد" : "Activation codes"}</h2><div className="flex gap-2"><div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={codeSearch} onChange={(e) => setCodeSearch(e.target.value)} placeholder={ar ? "ابحث بالكود أو الخطة" : "Search"} className="rounded-full ps-9" /></div><Button variant="outline" size="sm" className="rounded-full" onClick={exportCodesCsv} disabled={!filteredRows.length}><Download className="me-1 size-3.5" />CSV</Button></div></div><table className="w-full text-sm"><thead className="text-muted-foreground"><tr><th className="p-2 text-start">{ar ? "الكود" : "Code"}</th><th className="p-2 text-start">{ar ? "الخطة" : "Plan"}</th><th className="p-2 text-start">{ar ? "الأيام" : "Days"}</th><th className="p-2 text-start">{ar ? "الاستخدام" : "Uses"}</th><th className="p-2 text-start">{ar ? "الملاحظة" : "Note"}</th><th className="p-2 text-start">{ar ? "الحالة" : "Status"}</th><th /></tr></thead><tbody>{filteredRows.map((r) => <tr key={r.id} className="border-t border-border"><td className="p-2 font-mono font-bold">{r.code}</td><td className="p-2">{displayPlan(r.plan, r.note, ar)}</td><td className="p-2">{r.durationDays}</td><td className="p-2">{r.usedCount}/{r.maxUses}</td><td className="p-2 text-muted-foreground">{r.note ?? "—"}</td><td className="p-2">{r.active ? (ar ? "فعّال" : "Active") : (ar ? "موقوف" : "Disabled")}</td><td className="flex gap-1 p-2"><Button variant="ghost" size="sm" className="rounded-full" onClick={() => { void navigator.clipboard.writeText(r.code); toast.success(ar ? "تم النسخ" : "Copied"); }}><Copy className="size-3.5" /></Button><Button variant="ghost" size="sm" className="rounded-full text-emerald" title={ar ? "إرسال عبر واتساب" : "WhatsApp"} onClick={() => openWhatsApp(r.code, r.plan, r.durationDays, "", r.note, isGiftNote(r.note))}><MessageCircle className="size-3.5" /></Button><Button variant="outline" size="sm" className="rounded-full text-xs" onClick={() => void toggle(r)}>{r.active ? (ar ? "إيقاف" : "Disable") : (ar ? "تفعيل" : "Enable")}</Button></td></tr>)}{!filteredRows.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{ar ? "لا توجد أكواد." : "No codes."}</td></tr>}</tbody></table></Card>

        <Card className="overflow-x-auto rounded-3xl p-2"><div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-display text-lg font-bold"><Users className="me-2 inline size-5 text-primary" />{ar ? "المشتركون والأكواد المستخدمة" : "Subscribers & redemptions"}</h2><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={redemptionSearch} onChange={(e) => setRedemptionSearch(e.target.value)} placeholder={ar ? "ابحث بالكود أو البريد" : "Search"} className="rounded-full ps-9" /></div><select value={redemptionStatus} onChange={(e) => setRedemptionStatus(e.target.value as "all" | "active" | "expired")} className="h-9 rounded-full border border-input bg-background px-3 text-sm"><option value="all">{ar ? "الكل" : "All"}</option><option value="active">{ar ? "نشط" : "Active"}</option><option value="expired">{ar ? "منتهي" : "Expired"}</option></select><Button variant="outline" size="sm" className="rounded-full" onClick={exportRedemptionsCsv} disabled={!filteredRedemptions.length}><Download className="me-1 size-3.5" />CSV</Button></div></div><table className="w-full text-sm"><thead className="text-muted-foreground"><tr><th className="p-2 text-start">{ar ? "الكود" : "Code"}</th><th className="p-2 text-start">{ar ? "الخطة" : "Plan"}</th><th className="p-2 text-start">{ar ? "العميل" : "Customer"}</th><th className="p-2 text-start">{ar ? "الاستخدام" : "Redeemed"}</th><th className="p-2 text-start">{ar ? "الانتهاء" : "Expires"}</th><th className="p-2 text-start">{ar ? "المتبقي" : "Left"}</th><th className="p-2 text-start">{ar ? "الحالة" : "Status"}</th><th /></tr></thead><tbody>{filteredRedemptions.map((r) => { const active = isActive(r); return <tr key={r.id} className="border-t border-border"><td className="p-2 font-mono font-bold">{r.code}</td><td className="p-2">{displayPlan(r.plan, r.note, ar)}</td><td className="p-2"><div>{r.userEmail ?? "—"}</div>{r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}</td><td className="p-2">{fmtDate(r.redeemedAt, ar)}</td><td className="p-2">{fmtDate(r.subscriptionExpiresAt, ar)}</td><td className="p-2 font-bold">{daysLeft(r) === null ? "—" : ar ? `${daysLeft(r)} يوم` : `${daysLeft(r)} days`}</td><td className="p-2"><span className={active ? "rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary" : "rounded-full bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive"}>{active ? (ar ? "نشط" : "Active") : (ar ? "منتهي" : "Expired")}</span></td><td className="p-2"><Button variant="outline" size="sm" className="rounded-full text-xs" disabled={busy} onClick={() => void renew(r)}><RefreshCw className="me-1 size-3.5" />{ar ? "تجديد" : "Renew"}</Button></td></tr>; })}{!filteredRedemptions.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{ar ? "لا توجد بيانات." : "No data."}</td></tr>}</tbody></table></Card>
      </div>
    </main>
  );
}
