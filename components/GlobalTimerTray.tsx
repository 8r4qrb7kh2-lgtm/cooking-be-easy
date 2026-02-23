"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Clock3,
  Plus,
  TimerReset,
  Trash2,
} from "lucide-react";
import {
  GlobalTimer,
  GLOBAL_TIMERS_CHANGED_EVENT,
  GLOBAL_TIMERS_STORAGE_KEY,
  addGlobalTimer,
  clearCompletedGlobalTimers,
  getTimerRemainingSeconds,
  loadGlobalTimers,
  markGlobalTimerCompleted,
  markGlobalTimerNotified,
  removeGlobalTimer,
} from "@/lib/globalTimers";

interface ToastAlert {
  id: string;
  label: string;
  createdAt: number;
}

export interface SuggestedTimer {
  id: string;
  buttonLabel: string;
  durationSeconds: number;
  title: string;
  recipeId?: string;
  stepNumber?: number;
}

interface Props {
  className?: string;
  suggestedTimers?: SuggestedTimer[];
}

function formatRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export default function GlobalTimerTray({
  className = "",
  suggestedTimers = [],
}: Props) {
  const [timers, setTimers] = useState<GlobalTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [customLabel, setCustomLabel] = useState("");
  const [minutesInput, setMinutesInput] = useState("5");
  const [toasts, setToasts] = useState<ToastAlert[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");

  const activeCount = useMemo(
    () => timers.filter((timer) => !timer.completedAt).length,
    [timers]
  );

  const nearestRemaining = useMemo(() => {
    const active = timers.filter((timer) => !timer.completedAt);
    if (active.length === 0) return null;
    const minRemaining = Math.min(
      ...active.map((timer) => getTimerRemainingSeconds(timer, now))
    );
    return minRemaining;
  }, [timers, now]);

  useEffect(() => {
    const refresh = () => {
      setTimers(loadGlobalTimers());
    };

    refresh();

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === GLOBAL_TIMERS_STORAGE_KEY) {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(GLOBAL_TIMERS_CHANGED_EVENT, refresh);

    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
    } else {
      setNotificationPermission(Notification.permission);
    }

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(GLOBAL_TIMERS_CHANGED_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    const dueTimers = timers.filter(
      (timer) => !timer.completedAt && getTimerRemainingSeconds(timer, now) === 0
    );

    if (dueTimers.length === 0) {
      return;
    }

    const completedAt = Date.now();
    for (const timer of dueTimers) {
      markGlobalTimerCompleted(timer.id, completedAt);
      setToasts((prev) => [
        ...prev,
        {
          id: `${timer.id}-${completedAt}`,
          label: timer.label,
          createdAt: completedAt,
        },
      ]);

      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([120, 40, 120]);
      }

      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          new Notification("Cooking timer done", {
            body: timer.label,
            tag: `cooking-be-easy-${timer.id}`,
          });
          markGlobalTimerNotified(timer.id, completedAt);
        }
      }
    }

    setTimers(loadGlobalTimers());
  }, [timers, now]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timeout = window.setTimeout(() => {
      const cutoff = Date.now() - 12000;
      setToasts((prev) => prev.filter((toast) => toast.createdAt >= cutoff));
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [toasts]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function handleAddCustomTimer() {
    const minutes = Number(minutesInput);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const fallbackLabel = `${minutes} min timer`;
    const label = customLabel.trim() || fallbackLabel;
    addGlobalTimer({
      label,
      durationSeconds: Math.round(minutes * 60),
    });
    setTimers(loadGlobalTimers());
    setCustomLabel("");
  }

  function handleStartSuggestedTimer(timer: SuggestedTimer) {
    addGlobalTimer({
      label: timer.title,
      durationSeconds: timer.durationSeconds,
      recipeId: timer.recipeId,
      stepNumber: timer.stepNumber,
    });
    setTimers(loadGlobalTimers());
  }

  return (
    <>
      <section
        className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Global Timers</h3>
          <div className="text-right">
            <p className="text-xs text-gray-500 font-medium">{activeCount} active</p>
            {nearestRemaining !== null && (
              <p className="text-sm text-brand-700 font-semibold tabular-nums">
                Next: {formatRemaining(nearestRemaining)}
              </p>
            )}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-gray-100 space-y-2">
          {suggestedTimers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestedTimers.map((timer) => (
                <button
                  key={timer.id}
                  type="button"
                  onClick={() => handleStartSuggestedTimer(timer)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors"
                >
                  <Clock3 size={11} />
                  Start {timer.buttonLabel}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] gap-1.5 items-center">
            <input
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-full h-8 px-2.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
              type="number"
              min="0.1"
              step="0.1"
              className="w-full h-8 px-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleAddCustomTimer}
              className="h-8 px-3 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Plus size={12} />
              Start
            </button>
          </div>
          {notificationPermission === "default" && (
            <button
              type="button"
              onClick={enableNotifications}
              className="w-full text-[11px] rounded-md border border-brand-200 bg-brand-50 text-brand-700 py-1.5 hover:bg-brand-100 transition-colors flex items-center justify-center gap-1.5"
            >
              <Bell size={13} />
              Enable browser notifications
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto px-4 py-3">
          {timers.length === 0 ? (
            <p className="text-xs text-gray-500">No active timers yet.</p>
          ) : (
            <ul className="space-y-2">
              {timers.map((timer) => {
                const remaining = getTimerRemainingSeconds(timer, now);
                const complete = Boolean(timer.completedAt);
                return (
                  <li
                    key={timer.id}
                    className={`rounded-lg border px-3 py-2 ${
                      complete
                        ? "border-brand-200 bg-brand-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs font-medium leading-tight ${
                            complete ? "text-brand-800" : "text-gray-800"
                          }`}
                        >
                          {timer.label}
                        </p>
                        {complete ? (
                          <p className="text-sm mt-1 text-brand-700 font-medium">Done</p>
                        ) : (
                          <p className="mt-1 text-2xl leading-none font-bold text-brand-700 tabular-nums">
                            {formatRemaining(remaining)}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          removeGlobalTimer(timer.id);
                          setTimers(loadGlobalTimers());
                        }}
                        className="text-gray-400 hover:text-gray-600"
                        title="Remove timer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {timers.some((timer) => timer.completedAt) && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                clearCompletedGlobalTimers();
                setTimers(loadGlobalTimers());
              }}
              className="w-full text-xs py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <TimerReset size={13} />
              Clear completed
            </button>
          </div>
        )}
      </section>

      <div className="fixed top-24 right-4 z-[60] space-y-2 pointer-events-none">
        {toasts.slice(-3).map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto max-w-xs rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 shadow-md"
          >
            <p className="text-xs font-semibold text-brand-800">Timer finished</p>
            <p className="text-xs text-brand-700 mt-0.5">{toast.label}</p>
          </div>
        ))}
      </div>
    </>
  );
}
