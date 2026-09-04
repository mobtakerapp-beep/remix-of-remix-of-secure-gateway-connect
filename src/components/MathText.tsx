import type { ReactNode } from "react";

type Numerals = "auto" | "ar" | "en";

type Props = {
  text: string;
  className?: string;
  numerals?: Numerals;
};

function toArabicDigits(value: string) {
  return value.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
}

function toEnglishDigits(value: string) {
  return value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function normalizeDigits(value: string, numerals: Numerals) {
  if (numerals === "ar") return toArabicDigits(value);
  if (numerals === "en") return toEnglishDigits(value);
  return value;
}

function normalizeSuperscript(value: string, numerals: Numerals) {
  const superscriptMap: Record<string, string> = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁺": "+",
    "⁻": "−",
    "⁽": "(",
    "⁾": ")",
  };
  const plain = value
    .split("")
    .map((char) => superscriptMap[char] ?? char)
    .join("");
  return normalizeDigits(plain, numerals);
}

function Fraction({ numerator, denominator, numerals }: { numerator: string; denominator: string; numerals: Numerals }) {
  return (
    <span className="mx-0.5 inline-flex min-w-[1.35em] translate-y-[0.08em] flex-col items-center align-middle font-medium leading-none" dir="ltr">
      <span className="px-1 leading-[1.05]">{normalizeDigits(numerator.trim(), numerals)}</span>
      <span className="w-full border-t border-current px-1 pt-0.5 text-center leading-[1.05]">{normalizeDigits(denominator.trim(), numerals)}</span>
    </span>
  );
}

function Superscript({ value, numerals }: { value: string; numerals: Numerals }) {
  return <sup className="mx-px align-super text-[0.68em] leading-none">{normalizeSuperscript(value, numerals)}</sup>;
}

export function MathText({ text, className, numerals = "auto" }: Props) {
  // Supports both explicit LaTeX-style fractions and simple numeric fractions.
  // The latter is intentionally limited to numeric operands so normal prose
  // such as dates and URLs is not unexpectedly reformatted.
  const token = /\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}|([0-9٠-٩]{1,4})\s*\/\s*([0-9٠-٩]{1,4})|\^\s*\{([^{}]+)\}|\^\s*([0-9٠-٩⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = token.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <Fraction
          key={`f-${key++}`}
          numerator={match[1]}
          denominator={match[2]!}
          numerals={numerals}
        />,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <Fraction
          key={`s-${key++}`}
          numerator={match[3]}
          denominator={match[4]!}
          numerals={numerals}
        />,
      );
    } else {
      nodes.push(
        <Superscript
          key={`e-${key++}`}
          value={match[5] ?? match[6] ?? ""}
          numerals={numerals}
        />,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return <span className={className}>{nodes.length ? nodes : text}</span>;
}
