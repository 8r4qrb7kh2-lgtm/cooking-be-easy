import { Ingredient } from "./types";

export interface IngredientMatcher {
  ingredient: Ingredient;
  patterns: string[];
}

export interface StepIngredientCitation {
  ingredientId: string;
  start: number;
  end: number;
  mention: string;
  defaultAmount: string;
}

const STEP_PREFIX_PATTERN =
  /^(?:step\s*\d+\s*[:.)-]?\s*|\(?\d+\)?\s*[:.)-]\s*)/i;

const UNICODE_FRACTIONS: Record<string, string> = {
  "\u00BC": "1/4",
  "\u00BD": "1/2",
  "\u00BE": "3/4",
  "\u2153": "1/3",
  "\u2154": "2/3",
  "\u215B": "1/8",
  "\u215C": "3/8",
  "\u215D": "5/8",
  "\u215E": "7/8",
};

const TEXTUAL_QUANTITY_PATTERN =
  /(?:\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b|\bhalf\b|\bquarter\b|\ban\b|\ba\b)/i;

export function normalizeRecipeStep(step: string): string {
  return step
    .replace(/\s+/g, " ")
    .trim()
    .replace(STEP_PREFIX_PATTERN, "")
    .trim();
}

export function normalizeRecipeSteps(steps: string[]): string[] {
  return steps
    .filter((step): step is string => typeof step === "string")
    .map((step) => normalizeRecipeStep(step))
    .filter(Boolean);
}

export function normalizeQuantityText(value: string): string {
  return value
    .trim()
    .replace(/[\u2012\u2013\u2014]/g, "-")
    .replace(/(\d)([\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E])/g, "$1 $2")
    .replace(/([\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E])(\d)/g, "$1 $2")
    .replace(
      /[\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E]/g,
      (match) => ` ${UNICODE_FRACTIONS[match] ?? match} `
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseSingleQuantity(value: string): number | null {
  const normalized = normalizeQuantityText(value).replace(/,/g, "");
  if (!normalized) return null;

  const mixedFraction = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/
  );
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (!Number.isFinite(whole) || denominator === 0) return null;

    const fraction = numerator / denominator;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * fraction;
  }

  const fraction = normalized.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }

  if (/^-?\d*\.?\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function formatScaledQuantity(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(rounded) < 0.000001) return "0";
  return rounded
    .toString()
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatServingCount(value: number): string {
  const formatted = formatScaledQuantity(value);
  return `${formatted} serving${formatted === "1" ? "" : "s"}`;
}

export function scaleQuantityValue(quantity: string, factor: number): string {
  if (!quantity || factor === 1) return quantity;

  const normalized = normalizeQuantityText(quantity);
  if (!normalized) return quantity;

  const range = normalized.match(/^(.+?)\s*(?:-|to)\s*(.+)$/i);
  if (range) {
    const start = parseSingleQuantity(range[1]);
    const end = parseSingleQuantity(range[2]);
    if (start === null || end === null) return quantity;
    return `${formatScaledQuantity(start * factor)}-${formatScaledQuantity(
      end * factor
    )}`;
  }

  const parsed = parseSingleQuantity(normalized);
  if (parsed === null) return quantity;
  return formatScaledQuantity(parsed * factor);
}

export function formatIngredientAmount(
  ingredient: Ingredient,
  quantityScale: number
): string {
  if (!ingredient.quantity) return "";
  const scaled = scaleQuantityValue(ingredient.quantity, quantityScale);
  return `${scaled}${ingredient.unit ? ` ${ingredient.unit}` : ""}`.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIngredientText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWordForms(word: string): string[] {
  const normalized = normalizeIngredientText(word);
  if (!normalized) return [];

  const forms = new Set<string>([normalized]);

  if (normalized.endsWith("ies") && normalized.length > 4) {
    forms.add(`${normalized.slice(0, -3)}y`);
  } else if (
    /(ches|shes|xes|zes|ses|oes)$/.test(normalized) &&
    normalized.length > 4
  ) {
    forms.add(normalized.slice(0, -2));
  } else if (
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    normalized.length > 3
  ) {
    forms.add(normalized.slice(0, -1));
  }

  if (!normalized.endsWith("s")) {
    if (normalized.endsWith("y") && normalized.length > 3) {
      forms.add(`${normalized.slice(0, -1)}ies`);
    } else {
      forms.add(`${normalized}s`);
    }
  }

  return Array.from(forms).filter((form) => form.length > 1);
}

export function buildIngredientPatterns(name: string): string[] {
  const normalizedName = normalizeIngredientText(name);
  if (!normalizedName) return [];

  const words = normalizedName.split(" ").filter(Boolean);
  const phrases = new Set<string>();

  const addPhrase = (phrase: string) => {
    const normalizedPhrase = normalizeIngredientText(phrase);
    if (!normalizedPhrase || normalizedPhrase.length < 3) return;
    phrases.add(normalizedPhrase);
  };

  addPhrase(normalizedName);

  if (words.length > 1) {
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 2; end <= words.length; end++) {
        addPhrase(words.slice(start, end).join(" "));
      }
    }

    const prefix = words.slice(0, -1).join(" ");
    const lastWord = words[words.length - 1];
    for (const form of getWordForms(lastWord)) {
      addPhrase(`${prefix} ${form}`);
      addPhrase(form);
    }
  } else {
    for (const form of getWordForms(words[0])) {
      addPhrase(form);
    }
  }

  return Array.from(phrases)
    .sort((a, b) => b.length - a.length)
    .map((phrase) =>
      phrase
        .split(" ")
        .map((word) => escapeRegExp(word))
        .join("[\\s-]+")
    );
}

export function buildIngredientMatchers(
  ingredients: Ingredient[]
): IngredientMatcher[] {
  return ingredients.map((ingredient) => ({
    ingredient,
    patterns: buildIngredientPatterns(ingredient.name),
  }));
}

export function stepMentionsIngredient(
  stepText: string,
  matcher: IngredientMatcher
): boolean {
  return matcher.patterns.some((pattern) =>
    new RegExp(`\\b${pattern}\\b`, "i").test(stepText)
  );
}

function findAmountPrefixStart(stepText: string, mentionStart: number): number {
  const lookback = stepText.slice(Math.max(0, mentionStart - 28), mentionStart);
  const numericMatch = lookback.match(
    /(?:\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?|\d+-\d+)\s*(?:[a-zA-Z]+)?\s*$/
  );
  if (numericMatch) {
    return mentionStart - numericMatch[0].length;
  }

  const textualMatch = lookback.match(
    /(?:one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|an|a)\s*(?:[a-zA-Z]+)?\s*$/i
  );

  if (textualMatch) {
    const trimmed = textualMatch[0].trim();
    if (!TEXTUAL_QUANTITY_PATTERN.test(trimmed)) {
      return mentionStart;
    }
    if (/^(a|an)$/i.test(trimmed)) {
      return mentionStart;
    }
    return mentionStart - textualMatch[0].length;
  }

  return mentionStart;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

export function findStepIngredientCitations(
  stepText: string,
  matchers: IngredientMatcher[]
): StepIngredientCitation[] {
  if (!stepText) return [];

  const candidates: Array<{
    ingredientId: string;
    start: number;
    end: number;
    mention: string;
    defaultAmount: string;
  }> = [];

  for (const matcher of matchers) {
    for (const pattern of matcher.patterns) {
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(stepText)) !== null) {
        const mentionStart = match.index;
        const mentionEnd = mentionStart + match[0].length;
        const start = findAmountPrefixStart(stepText, mentionStart);

        candidates.push({
          ingredientId: matcher.ingredient.id,
          start,
          end: mentionEnd,
          mention: match[0],
          defaultAmount: formatIngredientAmount(matcher.ingredient, 1),
        });

        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.start - b.start;
  });

  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const hasOverlap = selected.some((range) =>
      overlaps(candidate.start, candidate.end, range.start, range.end)
    );
    if (!hasOverlap) {
      selected.push(candidate);
    }
  }

  selected.sort((a, b) => a.start - b.start);

  return selected;
}

export function formatIngredientCitationText(
  citation: StepIngredientCitation,
  ingredientById: Map<string, Ingredient>,
  quantityScale: number
): string {
  const ingredient = ingredientById.get(citation.ingredientId);
  const mention = citation.mention.trim();

  if (!ingredient) {
    const fallback = [citation.defaultAmount, mention].filter(Boolean).join(" ");
    return fallback || mention;
  }

  const amount = formatIngredientAmount(ingredient, quantityScale);
  if (!amount) {
    return mention || ingredient.name;
  }

  return `${amount} ${mention || ingredient.name}`.replace(/\s+/g, " ").trim();
}
