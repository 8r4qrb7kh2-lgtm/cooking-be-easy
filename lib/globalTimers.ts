import { syncNativeTimerNotifications } from "./native";

export interface GlobalTimer {
  id: string;
  label: string;
  durationSeconds: number;
  endTime: number;
  createdAt: number;
  completedAt?: number;
  notifiedAt?: number;
  recipeId?: string;
  stepNumber?: number;
}

export interface NewGlobalTimerInput {
  label: string;
  durationSeconds: number;
  recipeId?: string;
  stepNumber?: number;
}

export interface TimerPreset {
  label: string;
  durationSeconds: number;
  sourceText: string;
}

export const GLOBAL_TIMERS_STORAGE_KEY = "cooking-be-easy-global-timers";
export const GLOBAL_TIMERS_CHANGED_EVENT = "cooking-be-easy-global-timers-changed";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeTimer(timer: unknown): GlobalTimer | null {
  if (!timer || typeof timer !== "object") return null;
  const source = timer as Partial<GlobalTimer>;
  if (
    typeof source.id !== "string" ||
    typeof source.label !== "string" ||
    !isFiniteNumber(source.durationSeconds) ||
    !isFiniteNumber(source.endTime) ||
    !isFiniteNumber(source.createdAt)
  ) {
    return null;
  }

  const sanitized: GlobalTimer = {
    id: source.id,
    label: source.label,
    durationSeconds: Math.max(1, Math.round(source.durationSeconds)),
    endTime: source.endTime,
    createdAt: source.createdAt,
  };

  if (isFiniteNumber(source.completedAt)) {
    sanitized.completedAt = source.completedAt;
  }
  if (isFiniteNumber(source.notifiedAt)) {
    sanitized.notifiedAt = source.notifiedAt;
  }
  if (typeof source.recipeId === "string") {
    sanitized.recipeId = source.recipeId;
  }
  if (isFiniteNumber(source.stepNumber)) {
    sanitized.stepNumber = Math.round(source.stepNumber);
  }

  return sanitized;
}

function emitTimersChanged() {
  if (!hasWindow()) return;
  window.dispatchEvent(new Event(GLOBAL_TIMERS_CHANGED_EVENT));
}

function writeTimers(timers: GlobalTimer[]) {
  if (!hasWindow()) return;
  window.localStorage.setItem(GLOBAL_TIMERS_STORAGE_KEY, JSON.stringify(timers));

  // Every add, cancel and completion funnels through here, which makes it the
  // one place the iOS app needs to hear about to keep its local notifications
  // in step with the tray. It is a no-op everywhere else.
  syncNativeTimerNotifications(
    timers
      .filter((timer) => !timer.completedAt)
      .map((timer) => ({
        id: timer.id,
        label: timer.label,
        fireAt: timer.endTime,
      }))
  );

  emitTimersChanged();
}

export function loadGlobalTimers(): GlobalTimer[] {
  if (!hasWindow()) return [];

  const raw = window.localStorage.getItem(GLOBAL_TIMERS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeTimer(item))
      .filter((item): item is GlobalTimer => item !== null)
      .sort((a, b) => a.endTime - b.endTime);
  } catch {
    return [];
  }
}

export function saveGlobalTimers(timers: GlobalTimer[]) {
  writeTimers(
    timers
      .map((timer) => sanitizeTimer(timer))
      .filter((timer): timer is GlobalTimer => timer !== null)
      .sort((a, b) => a.endTime - b.endTime)
  );
}

function generateTimerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `timer-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

export function addGlobalTimer(input: NewGlobalTimerInput): GlobalTimer | null {
  if (!hasWindow()) return null;

  const durationSeconds = Math.round(input.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const label = input.label.trim();
  if (!label) return null;

  const now = Date.now();
  const timer: GlobalTimer = {
    id: generateTimerId(),
    label,
    durationSeconds,
    createdAt: now,
    endTime: now + durationSeconds * 1000,
    ...(input.recipeId ? { recipeId: input.recipeId } : {}),
    ...(input.stepNumber ? { stepNumber: input.stepNumber } : {}),
  };

  const timers = loadGlobalTimers();
  saveGlobalTimers([...timers, timer]);
  return timer;
}

export function removeGlobalTimer(id: string) {
  if (!hasWindow()) return;
  const timers = loadGlobalTimers();
  saveGlobalTimers(timers.filter((timer) => timer.id !== id));
}

export function clearCompletedGlobalTimers() {
  if (!hasWindow()) return;
  const timers = loadGlobalTimers();
  saveGlobalTimers(timers.filter((timer) => !timer.completedAt));
}

export function markGlobalTimerCompleted(id: string, completedAt = Date.now()) {
  if (!hasWindow()) return;
  const timers = loadGlobalTimers();
  saveGlobalTimers(
    timers.map((timer) =>
      timer.id === id
        ? {
            ...timer,
            completedAt: timer.completedAt ?? completedAt,
          }
        : timer
    )
  );
}

export function markGlobalTimerNotified(id: string, notifiedAt = Date.now()) {
  if (!hasWindow()) return;
  const timers = loadGlobalTimers();
  saveGlobalTimers(
    timers.map((timer) =>
      timer.id === id
        ? {
            ...timer,
            notifiedAt: timer.notifiedAt ?? notifiedAt,
          }
        : timer
    )
  );
}

export function getTimerRemainingSeconds(timer: GlobalTimer, now = Date.now()): number {
  if (timer.completedAt) return 0;
  return Math.max(0, Math.ceil((timer.endTime - now) / 1000));
}

function parseTimerUnit(unit: string): { multiplier: number; shortLabel: string } | null {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("sec") || normalized === "s") {
    return { multiplier: 1, shortLabel: "sec" };
  }
  if (normalized.startsWith("min") || normalized === "m") {
    return { multiplier: 60, shortLabel: "min" };
  }
  if (normalized.startsWith("hour") || normalized.startsWith("hr") || normalized === "h") {
    return { multiplier: 60 * 60, shortLabel: "hr" };
  }
  return null;
}

export function extractTimerPresets(stepText: string): TimerPreset[] {
  if (!stepText) return [];

  const presets: TimerPreset[] = [];
  const rangeSpans: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();

  const rangeRegex = /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi;
  let rangeMatch: RegExpExecArray | null;

  while ((rangeMatch = rangeRegex.exec(stepText)) !== null) {
    const startValue = Number(rangeMatch[1]);
    const endValue = Number(rangeMatch[2]);
    const unit = parseTimerUnit(rangeMatch[3]);
    if (!unit || !Number.isFinite(startValue) || !Number.isFinite(endValue)) {
      continue;
    }

    const upper = Math.max(startValue, endValue);
    const durationSeconds = Math.max(1, Math.round(upper * unit.multiplier));
    const label = `${rangeMatch[1]}-${rangeMatch[2]} ${unit.shortLabel}`;
    const key = `${durationSeconds}-${label}`;
    if (!seen.has(key)) {
      presets.push({
        label,
        durationSeconds,
        sourceText: rangeMatch[0],
      });
      seen.add(key);
    }

    rangeSpans.push({
      start: rangeMatch.index,
      end: rangeMatch.index + rangeMatch[0].length,
    });
  }

  const singleRegex = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi;
  let singleMatch: RegExpExecArray | null;

  while ((singleMatch = singleRegex.exec(stepText)) !== null) {
    const start = singleMatch.index;
    const end = start + singleMatch[0].length;
    const overlapsRange = rangeSpans.some(
      (span) => start < span.end && end > span.start
    );
    if (overlapsRange) continue;

    const value = Number(singleMatch[1]);
    const unit = parseTimerUnit(singleMatch[2]);
    if (!unit || !Number.isFinite(value)) continue;

    const durationSeconds = Math.max(1, Math.round(value * unit.multiplier));
    const label = `${singleMatch[1]} ${unit.shortLabel}`;
    const key = `${durationSeconds}-${label}`;
    if (seen.has(key)) continue;

    presets.push({
      label,
      durationSeconds,
      sourceText: singleMatch[0],
    });
    seen.add(key);
  }

  return presets;
}
