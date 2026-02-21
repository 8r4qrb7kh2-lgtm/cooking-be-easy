"use client";

import { useEffect, useState } from "react";
import { X, Copy, Check, Loader2, Users, Link as LinkIcon } from "lucide-react";

interface Member {
  id: string;
  email: string;
  joinedAt: string;
  isYou: boolean;
}

interface HouseholdData {
  id: string;
  members: Member[];
}

export default function HouseholdModal({ onClose }: { onClose: () => void }) {
  const [household, setHousehold] = useState<HouseholdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/household")
      .then((r) => r.json())
      .then((data) => {
        setHousehold(data.household);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function generateInvite() {
    setGenerating(true);
    try {
      const res = await fetch("/api/household/invite", { method: "POST" });
      const data = await res.json();
      if (data.token) {
        setInviteUrl(`${window.location.origin}/invite/${data.token}`);
        // Refresh household info (user may have just created one)
        const hRes = await fetch("/api/household");
        const hData = await hRes.json();
        setHousehold(hData.household);
      }
    } catch {
      // silently fail
    } finally {
      setGenerating(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-brand-600" />
            Shared Library
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="text-brand-500 animate-spin" />
            </div>
          ) : household ? (
            <>
              {/* Members */}
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Members
                </p>
                <ul className="space-y-2">
                  {household.members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 text-sm text-gray-700"
                    >
                      <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold">
                        {m.email[0]?.toUpperCase() || "?"}
                      </div>
                      <span className="flex-1 truncate">{m.email}</span>
                      {m.isYou && (
                        <span className="text-xs text-gray-400">you</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Generate invite */}
              {!inviteUrl ? (
                <button
                  onClick={generateInvite}
                  disabled={generating}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-50 text-brand-700 rounded-xl font-medium text-sm hover:bg-brand-100 transition-colors disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <LinkIcon size={16} />
                  )}
                  Generate Invite Link
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Share this link (expires in 7 days):
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      className="flex-1 text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 truncate"
                    />
                    <button
                      onClick={copyLink}
                      className="shrink-0 p-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                    >
                      {copied ? (
                        <Check size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* No household yet */}
              <div className="text-center py-4">
                <Users size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 mb-4">
                  Share your recipe library with someone.
                  <br />
                  Recipes, meal plans, and shopping lists will be shared.
                </p>
                {!inviteUrl ? (
                  <button
                    onClick={generateInvite}
                    disabled={generating}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-xl font-medium text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 mx-auto"
                  >
                    {generating ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <LinkIcon size={16} />
                    )}
                    Generate Invite Link
                  </button>
                ) : (
                  <div className="space-y-2 text-left">
                    <p className="text-xs text-gray-500">
                      Share this link (expires in 7 days):
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="flex-1 text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 truncate"
                      />
                      <button
                        onClick={copyLink}
                        className="shrink-0 p-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                      >
                        {copied ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
