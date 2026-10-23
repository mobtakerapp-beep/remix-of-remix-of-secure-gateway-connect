import { Printer } from "lucide-react";
import { useRef, useState } from "react";

import { MindMap } from "@/components/MindMap";
import { SummaryPanel } from "@/components/SummaryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import type { LessonPackage } from "@/lib/lesson-types";

export function SummaryTab({ pkg }: { pkg: LessonPackage }) {
  const { t } = useI18n();
  const ar = pkg.language === "ar";
  const [teacher, setTeacher] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);

  const printSummary = () => {
    if (!sheetRef.current) {
      window.alert(ar ? "الملخص غير جاهز للطباعة. حاولي تحديث الصفحة." : "The summary is not ready to print. Please refresh the page.");
      return;
    }

    const cleanup = () => document.body.classList.remove("printing-summary");
    document.body.classList.add("printing-summary");
    window.addEventListener("afterprint", cleanup, { once: true });

    // Let the browser render the print-only layout before opening the dialog.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });

    // Safety fallback for browsers that do not fire afterprint.
    window.setTimeout(cleanup, 60000);
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-border bg-card p-4">
        <div className="min-w-56 flex-1">
          <Label htmlFor="teacher-summary">{t.teacherName}</Label>
          <Input
            id="teacher-summary"
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
            placeholder={t.teacherPlaceholder}
            className="mt-1.5 rounded-xl"
          />
        </div>
        <Button
          onClick={printSummary}
          className="rounded-full gradient-hero text-primary-foreground"
        >
          <Printer className="mr-2 size-4" /> {t.printSummary}
        </Button>
      </div>

      <div ref={sheetRef} className="worksheet-export rounded-3xl bg-card p-4 sm:p-6">
        <div dir={ar ? "rtl" : "ltr"} className="space-y-5">
          <header className="break-inside-avoid border-b-4 border-double border-primary pb-4">
            <p className="text-xs font-bold text-emerald">{t.summarySheetTitle}</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold leading-snug text-primary">
              {pkg.title}
            </h2>
          </header>

          <div className="break-inside-avoid">
            <SummaryPanel pkg={pkg} />
          </div>

          <section className="break-inside-avoid">
            <h3 className="mb-2 font-display text-base font-extrabold text-primary">
              {t.mindMapTitle}
            </h3>
            <MindMap pkg={pkg} />
          </section>

          <footer className="break-inside-avoid flex items-center justify-between gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>{teacher ? `${t.preparedBy} ${teacher}` : ""}</span>
            <span>{t.footer}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
