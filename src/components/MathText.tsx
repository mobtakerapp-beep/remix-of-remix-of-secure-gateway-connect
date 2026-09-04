import type { ReactNode } from "react";

type Props = {
  text: string;
  className?: string;
};

function Fraction({ numerator, denominator }: { numerator: string; denominator: string }) {
  return (
    <span className="mx-0.5 inline-flex min-w-[1.35em] translate-y-[0.08em] flex-col items-center align-middle font-medium leading-none" dir="ltr">
      <span className="px-1 leading-[1.05]">{numerator}</span>
      <span className="w-full border-t border-current px-1 pt-0.5 text-center leading-[1.05]">{denominator}</span>
    </span>
  );
}

function Superscript({ value }: { value: string }) {
  return <sup className="mx-px align-super text-[0.68em] leading-none">{value}</sup>;
}

export function MathText({ text, className }: Props) {
  const token = /\\frac\{([^{}]+)\}\{([^{}]+)\}|([0-9٠-٩]{1,3})\s*\/\s*([0-9٠-٩]{1,3})|\^\{([^{}]+)\}|\^([0-9٠-٩])/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = token.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(<Fraction key={`f-${key++}`} numerator={match[1]} denominator={match[2]!} />);
    } else if (match[3] !== undefined) {
      nodes.push(<Fraction key={`s-${key++}`} numerator={match[3]} denominator={match[4]!} />);
    } else {
      nodes.push(<Superscript key={`e-${key++}`} value={match[5] ?? match[6] ?? ""} />);
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return <span className={className}>{nodes.length ? nodes : text}</span>;
}
