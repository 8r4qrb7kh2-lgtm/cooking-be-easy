"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, ShoppingCart, Flame, LogOut, Users, Receipt } from "lucide-react";
import { useAuth } from "./AuthProvider";
import HouseholdModal from "./HouseholdModal";
import GooseChefLogo from "./GooseChefLogo";

const navItems = [
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/planner", label: "Plan", icon: CalendarDays },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/cook", label: "Cook", icon: Flame },
];

export default function Navigation() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [showHousehold, setShowHousehold] = useState(false);

  return (
    <>
      {/* Top header — scrolls away with the page (stays static) so pages like the
          planner can pin their own compact header at the very top instead. */}
      <header className="surface border-b surface-border pt-[env(safe-area-inset-top)]">
        <div className="max-w-4xl mx-auto px-4 h-28 sm:h-32 flex items-center gap-2 sm:gap-3 min-w-0">
          <GooseChefLogo variant="header" size={176} />
          <div className="flex-1" />
          {user && (
            <>
              <button
                onClick={() => setShowHousehold(true)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
                title="Shared library"
              >
                <Users size={14} />
              </button>
              <button
                onClick={signOut}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
                title="Sign out"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Bottom tab bar. The padding keeps the tabs clear of the iPhone home
          indicator; env() is 0 in a normal browser window. */}
      <nav className="fixed bottom-0 left-0 right-0 surface border-t surface-border z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto flex">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
                  active
                    ? "text-brand-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                <Icon size={22} />
                <span className="text-xs font-medium">{label}</span>
                {active && (
                  <span className="absolute bottom-0 w-8 h-0.5 bg-brand-600 rounded-t" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {showHousehold && (
        <HouseholdModal onClose={() => setShowHousehold(false)} />
      )}
    </>
  );
}
