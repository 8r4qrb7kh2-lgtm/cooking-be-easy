"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Clock3,
  Plus,
  TimerReset,
  Trash2,
  X,
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

export default function GlobalTimerTray() {
  const [timers, setTimers] = useState<GlobalTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <div className="fixed right-4 bottom-24 z-40">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-full bg-brand-600 text-white px-4 py-2.5 shadow-lg hover:bg-brand-700 transition-colors flex items-center gap-2"
          aria-label="Toggle timers"
        >
          <Clock3 size={16} />
          <span className="text-sm font-semibold">Timers</span>
          {activeCount > 0 && (
            <span className="text-xs rounded-full bg-white/20 px-2 py-0.5">
              {activeCount}
            </span>
          )}
        </button>
        {nearestRemaining !== null && !open && (
          <p className="text-[11px] text-right mt-1 text-gray-500 font-medium">
            Next: {formatRemaining(nearestRemaining)}
          </p>
        )}
      </div>

      {open && (
        <div className="fixed right-4 bottom-40 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Global Timers</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close timers"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-4 py-3 border-b border-gray-100 space-y-2.5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Add timer
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Label (optional)"
                className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div className="flex items-center gap-1">
                <input
                  value={minutesInput}
                  onChange={(e) => setMinutesInput(e.target.value)}
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="w-16 px-2 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <span className="text-xs text-gray-500">min</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddCustomTimer}
              className="w-full text-xs font-semibold rounded-lg bg-brand-600 text-white py-2 hover:bg-brand-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={13} />
              Start timer
            </button>
            {notificationPermission === "default" && (
              <button
                type="button"
                onClick={enableNotifications}
                className="w-full text-xs rounded-lg border border-brand-200 bg-brand-50 text-brand-700 py-2 hover:bg-brand-100 transition-colors flex items-center justify-center gap-1.5"
              >
                <Bell size={13} />
                Enable browser notifications
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto px-4 py-3">
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
                          <p
                            className={`text-[11px] mt-0.5 ${
                              complete ? "text-brand-700" : "text-gray-500"
                            }`}
                          >
                            {complete
                              ? "Done"
                              : `${formatRemaining(remaining)} remaining`}
                          </p>
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
        </div>
      )}

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
