import { Ingredient } from "./types";
import { formatIngredientAmount, normalizeRecipeStep } from "./recipeSteps";

/**
 * Builds the "recipe matrix" layout popularised by Cooking for Engineers: a
 * grid where every ingredient owns a row on the left and every operation owns a
 * column on the right, each operation cell spanning the rows it consumes.
 *
 * Setup steps that use no ingredients (preheating, greasing a pan) are hoisted
 * into full-width rows above the grid, exactly as the original format does.
 */

export interface RecipeTablePrepRow {
  stepIndex: number;
  text: string;
}

export interface RecipeTableRow {
  ingredient: Ingredient;
  stepIndex: number;
}

export interface RecipeTableColumn {
  stepIndex: number;
  /** Terse operation label shown in the cell, e.g. "fold in". */
  label: string;
  /** Full step text, kept for tooltips and the step-by-step view. */
  text: string;
  startRow: number;
  endRow: number;
}

export interface RecipeTable {
  prepRows: RecipeTablePrepRow[];
  rows: RecipeTableRow[];
  columns: RecipeTableColumn[];
}

// Longest phrases first so "fold in" wins over "fold" at the same position.
const OPERATION_PHRASES = [
  "bring to a rolling boil",
  "bring to a simmer",
  "bring to a boil",
  "cover and simmer",
  "cover and cook",
  "cover and bake",
  "remove from heat",
  "return to the pan",
  "sprinkle over",
  "sprinkle with",
  "spoon over",
  "pour over",
  "pour in",
  "stir in",
  "whisk in",
  "fold in",
  "mix in",
  "beat in",
  "toss with",
  "top with",
  "cut into",
  "cut in",
  "break up",
  "set aside",
  "let rest",
  "let cool",
  "let sit",
  "let rise",
  "heat through",
  "cook down",
  "preheat",
  "marinate",
  "assemble",
  "transfer",
  "sprinkle",
  "drizzle",
  "combine",
  "refrigerate",
  "caramelize",
  "caramelise",
  "garnish",
  "spread",
  "strain",
  "shred",
  "season",
  "simmer",
  "steam",
  "braise",
  "poach",
  "reduce",
  "arrange",
  "scatter",
  "blend",
  "knead",
  "cream",
  "whisk",
  "toast",
  "roast",
  "broil",
  "grill",
  "sauté",
  "saute",
  "layer",
  "slice",
  "mince",
  "grate",
  "drain",
  "rinse",
  "serve",
  "chill",
  "freeze",
  "mash",
  "puree",
  "deglaze",
  "blanch",
  "thicken",
  "ferment",
  "uncover",
  "sprinkle",
  "brush",
  "proof",
  "whip",
  "sift",
  "coat",
  "soak",
  "cover",
  "brown",
  "crisp",
  "melt",
  "bake",
  "boil",
  "beat",
  "fold",
  "sear",
  "stir",
  "chop",
  "dice",
  "peel",
  "cool",
  "rest",
  "rise",
  "wrap",
  "fill",
  "cook",
  "heat",
  "add",
  "fry",
  "mix",
  "rub",
] as const;

// "In a large skillet, ..." / "Once the pan is hot, ..." — scene-setting that
// carries no operation, so the fallback label skips past it.
const LEADING_CLAUSE_PATTERN =
  /^(?:in|on|with|using|once|when|while|as soon as|after|before|meanwhile|for|to)\b[^,]{0,44},\s*/i;

const TEMPERATURE_PATTERN =
  /\b(\d{2,3})\s*(?:°\s*([CF])|degrees?\s*(fahrenheit|celsius|[CF])?)/i;

const DURATION_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|\s*to\s*)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i;

function abbreviateDurationUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower.startsWith("s")) return "sec";
  if (lower.startsWith("h")) return "hr";
  return "min";
}

function formatTemperature(match: RegExpMatchArray): string {
  const value = match[1];
  const scaleFromDegreeSign = match[2];
  const scaleFromWord = match[3];
  const raw = (scaleFromDegreeSign || scaleFromWord || "").toLowerCase();
  const scale = raw.startsWith("c") ? "C" : raw.startsWith("f") ? "F" : "";
  return scale ? `${value}°${scale}` : `${value}°`;
}

/** Pulls "350°F (170°C)" out of a step, keeping a metric companion if present. */
function extractTemperature(text: string): string {
  const match = text.match(TEMPERATURE_PATTERN);
  if (!match || match.index === undefined) return "";

  const primary = formatTemperature(match);
  const rest = text.slice(match.index + match[0].length);
  const companion = rest.match(/^\s*\(\s*([^)]*)\)/);
  if (companion) {
    const inner = companion[1].match(TEMPERATURE_PATTERN);
    if (inner) return `${primary} (${formatTemperature(inner)})`;
  }

  return primary;
}

function extractDuration(text: string): string {
  const match = text.match(DURATION_PATTERN);
  if (!match) return "";

  const unit = abbreviateDurationUnit(match[3]);
  return match[2]
    ? `${match[1]} to ${match[2]} ${unit}`
    : `${match[1]} ${unit}`;
}

function findOperationPhrase(text: string): string {
  let best: { phrase: string; index: number } | null = null;

  for (const phrase of OPERATION_PHRASES) {
    const match = text.match(
      new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}(?:s|ed|ing)?\\b`, "i")
    );
    if (!match || match.index === undefined) continue;

    if (
      !best ||
      match.index < best.index ||
      (match.index === best.index && phrase.length > best.phrase.length)
    ) {
      best = { phrase, index: match.index };
    }
  }

  return best ? best.phrase : "";
}

/**
 * Condenses a full sentence step into the few words a matrix cell can hold —
 * the operation itself plus the temperature and time that make it actionable.
 */
export function condenseStepLabel(step: string): string {
  const text = normalizeRecipeStep(step);
  if (!text) return "";

  const phrase = findOperationPhrase(text);
  const temperature = extractTemperature(text);
  const duration = extractDuration(text);

  if (phrase) {
    return [phrase, temperature, duration].filter(Boolean).join(" ");
  }

  const fallback = text
    .replace(LEADING_CLAUSE_PATTERN, "")
    .replace(/[.!?][\s\S]*$/, "")
    .split(/\s+/)
    .slice(0, 4)
    .join(" ")
    .toLowerCase();

  const summary = [fallback, temperature, duration].filter(Boolean).join(" ");
  return summary || text.slice(0, 40);
}

export function formatRecipeTableIngredient(
  ingredient: Ingredient,
  quantityScale: number
): string {
  const amount = formatIngredientAmount(ingredient, quantityScale);
  return amount ? `${amount} ${ingredient.name}` : ingredient.name;
}

/**
 * @param firstStepById first step each ingredient is needed in, as already
 *   resolved by cooking mode (AI mapping, falling back to text matching).
 * @param labelByStep optional AI-written operation labels, keyed by step index.
 */
export function buildRecipeTable(
  ingredients: Ingredient[],
  steps: string[],
  firstStepById: Map<string, number>,
  labelByStep?: Record<number, string> | null
): RecipeTable {
  const empty: RecipeTable = { prepRows: [], rows: [], columns: [] };
  if (steps.length === 0) return empty;

  const labelFor = (stepIndex: number) => {
    const aiLabel = labelByStep?.[stepIndex];
    if (typeof aiLabel === "string" && aiLabel.trim()) return aiLabel.trim();
    return condenseStepLabel(steps[stepIndex]);
  };

  // Every step becomes a full-width prep row when there is nothing to lay out
  // in a grid.
  if (ingredients.length === 0) {
    return {
      prepRows: steps.map((text, stepIndex) => ({
        stepIndex,
        text: normalizeRecipeStep(text),
      })),
      rows: [],
      columns: [],
    };
  }

  const ingredientsByStep = new Map<number, Ingredient[]>();
  const unassigned: Ingredient[] = [];

  for (const ingredient of ingredients) {
    const stepIndex = firstStepById.get(ingredient.id);
    if (
      stepIndex === undefined ||
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      stepIndex >= steps.length
    ) {
      unassigned.push(ingredient);
      continue;
    }

    const existing = ingredientsByStep.get(stepIndex);
    if (existing) existing.push(ingredient);
    else ingredientsByStep.set(stepIndex, [ingredient]);
  }

  const ingredientSteps = Array.from(ingredientsByStep.keys()).sort(
    (a, b) => a - b
  );

  // Nothing could be matched to a step: hang every ingredient off step 1 so the
  // grid still reads top to bottom.
  if (ingredientSteps.length === 0) {
    ingredientSteps.push(0);
    ingredientsByStep.set(0, []);
  }

  // Ingredients the mapping missed join the last group that has any, keeping
  // each step's rows contiguous.
  const lastIngredientStep = ingredientSteps[ingredientSteps.length - 1];
  if (unassigned.length > 0) {
    const group = ingredientsByStep.get(lastIngredientStep) ?? [];
    ingredientsByStep.set(lastIngredientStep, [...group, ...unassigned]);
  }

  const rows: RecipeTableRow[] = [];
  for (const stepIndex of ingredientSteps) {
    for (const ingredient of ingredientsByStep.get(stepIndex) ?? []) {
      rows.push({ ingredient, stepIndex });
    }
  }

  const firstIngredientStep = ingredientSteps[0];
  const prepRows: RecipeTablePrepRow[] = [];
  for (let stepIndex = 0; stepIndex < firstIngredientStep; stepIndex++) {
    prepRows.push({ stepIndex, text: normalizeRecipeStep(steps[stepIndex]) });
  }

  const lastRow = rows.length - 1;
  const columns: RecipeTableColumn[] = [];
  let coveredThrough = -1;

  for (let stepIndex = firstIngredientStep; stepIndex < steps.length; stepIndex++) {
    let ownLastRow = -1;
    for (let row = rows.length - 1; row >= 0; row--) {
      if (rows[row].stepIndex === stepIndex) {
        ownLastRow = row;
        break;
      }
    }

    // Each operation consumes everything produced so far plus whatever this
    // step introduces, so its cell grows downward and never shrinks.
    coveredThrough = Math.max(coveredThrough, ownLastRow, 0);

    columns.push({
      stepIndex,
      label: labelFor(stepIndex),
      text: normalizeRecipeStep(steps[stepIndex]),
      startRow: 0,
      endRow: Math.min(coveredThrough, lastRow),
    });
  }

  return { prepRows, rows, columns };
}
