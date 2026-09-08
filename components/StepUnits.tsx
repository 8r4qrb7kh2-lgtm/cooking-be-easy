import { Fragment } from "react";

/** Add display-only unit cues without changing stored amounts or citation offsets. */
export function formatStepUnits(text: string) {
  const formatted = text.replace(
    /\b(tbsp|tsp)\b(?!\s*\((?:🍽️|🍵)\))/gi,
    (unit) => `${unit} (${unit.toLowerCase() === "tbsp" ? "🍽️" : "🍵"})`
  );
  if (!formatted.includes("🍽️")) return formatted;

  return formatted.split("🍽️").map((part, index) => (
    <Fragment key={index}>
      {index > 0 && (
        <img
          src="/images/table-emoji.png"
          alt="table"
          width={20}
          height={20}
          className="inline-block h-[1em] w-[1em] align-[-0.125em] object-contain"
        />
      )}
      {part}
    </Fragment>
  ));
}
