"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, ShoppingCart, Flame, LogOut, Users } from "lucide-react";
import { useAuth } from "./AuthProvider";
import HouseholdModal from "./HouseholdModal";
import GooseChefLogo from "./GooseChefLogo";

const navItems = [
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/cook", label: "Cook", icon: Flame },
];

export default function Navigation() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [showHousehold, setShowHousehold] = useState(false);

  return (
    <>
      {/* Top header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-24 flex items-center gap-3">
          <GooseChefLogo variant="header" size={88} />
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
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="max-w-4xl mx-auto flex">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
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
