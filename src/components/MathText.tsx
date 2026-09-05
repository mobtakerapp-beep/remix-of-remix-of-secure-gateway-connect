import { useEffect, useRef } from "react";

type Numerals = "auto" | "ar" | "en";

type Props = {
  text: string;
  className?: string;
  numerals?: Numerals;
};

type MathJaxApi = {
  typesetPromise: (elements?: HTMLElement[]) => Promise<void>;
  startup?: { promise?: Promise<unknown> };
};

declare global {
  interface Window {
    MathJax?: MathJaxApi;
  }
}

let mathJaxPromise: Promise<MathJaxApi> | null = null;

function loadMathJax() {
  if (typeof window === "undefined") return Promise.reject(new Error("MathJax requires a browser"));
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
  if (mathJaxPromise) return mathJaxPromise;

  mathJaxPromise = new Promise<MathJaxApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-mathjax="true"]');
    if (existing) {
      existing.addEventListener("load", () => window.MathJax ? resolve(window.MathJax) : reject(new Error("MathJax did not initialize")), { once: true });
      existing.addEventListener("error", () => reject(new Error("MathJax failed to load")), { once: true });
      return;
    }

    const config = document.createElement("script");
    config.type = "text/javascript";
    config.text = `window.MathJax = {
      tex: {
        inlineMath: [['\\\\(', '\\\\)'], ['$', '$']],
        displayMath: [['\\\\[', '\\\\]'], ['$$', '$$']],
        processEscapes: true,
        processEnvironments: true,
        tags: 'ams'
      },
      svg: { fontCache: 'global' },
      options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }
    };`;
    document.head.appendChild(config);

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js";
    script.async = true;
    script.dataset.mathjax = "true";
    script.onload = () => {
      const mj = window.MathJax;
      if (mj?.typesetPromise) resolve(mj);
      else reject(new Error("MathJax did not initialize"));
    };
    script.onerror = () => reject(new Error("MathJax failed to load"));
    document.head.appendChild(script);
  });

  return mathJaxPromise;
}

function normalizeArabicMath(value: string) {
  const superscriptMap: Record<string, string> = {
    "⁰": "٠", "¹": "١", "²": "٢", "³": "٣", "⁴": "٤",
    "⁵": "٥", "⁶": "٦", "⁷": "٧", "⁸": "٨", "⁹": "٩",
  };

  let normalized = value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) =>
    `^{${Array.from(run).map((digit) => superscriptMap[digit] ?? digit).join("")}}`,
  );

  normalized = normalized
    .replace(/(^|[^A-Za-z])([xX])([^A-Za-z]|$)/g, "$1س$3")
    .replace(/(^|[^A-Za-z])([yY])([^A-Za-z]|$)/g, "$1ص$3")
    .replace(/(^|[^A-Za-z])([zZ])([^A-Za-z]|$)/g, "$1ع$3");

  normalized = normalized
    .replace(/∛[ \t]*([0-9٠-٩]+)/g, (_match, radicand) => String.raw`\sqrt[٣]{${radicand}}`)
    .replace(/∜[ \t]*([0-9٠-٩]+)/g, (_match, radicand) => String.raw`\sqrt[٤]{${radicand}}`)
    .replace(/√[ \t]*([0-9٠-٩]+)/g, (_match, radicand) => String.raw`\sqrt{${radicand}}`);

  return normalized;
}

function normalizeDigits(value: string, numerals: Numerals) {
  if (numerals === "ar") return value.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
  if (numerals === "en") return value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return value;
}

/**
 * One rendering engine for all mathematical content in the app.
 * Supports LaTeX fractions, powers, roots, integrals, derivatives and ∂,
 * matrices, limits, sequences, logarithms, trigonometry, Greek/geometric
 * symbols, inequalities and aligned equations.
 *
 * Arabic text stays RTL; MathJax isolates each formula as mathematical LTR
 * content so Arabic sentences remain Arabic while the formula keeps its shape.
 */
export function MathText({ text, className, numerals = "auto" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const mathSource = numerals === "ar" ? normalizeArabicMath(text) : text;
  const normalized = normalizeDigits(mathSource, numerals);

  useEffect(() => {
    let cancelled = false;
    const element = ref.current;
    if (!element) return;

    element.replaceChildren(document.createTextNode(normalized));

    void loadMathJax()
      .then(async (mathJax) => {
        if (cancelled || !ref.current) return;
        await mathJax.startup?.promise;
        if (!cancelled && ref.current) await mathJax.typesetPromise([ref.current]);
      })
      .catch((error) => {
        console.warn("Math rendering unavailable; showing source notation.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return (
    <span
      ref={ref}
      className={className}
      dir="auto"
      style={{ unicodeBidi: "plaintext" }}
    />
  );
}
