"use client";

import { usePathname } from "next/navigation";

// Most pages read best at a comfortable text width. The planner's scatter plot,
// though, wants the whole screen so recipes can spread out horizontally instead
// of stacking in a narrow column, so it opts out of the max-width.
export default function MainContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fullWidth = pathname === "/planner";

  return (
    <main
      className={`mx-auto px-4 py-6 pb-[calc(6rem_+_env(safe-area-inset-bottom))] ${
        fullWidth ? "max-w-none" : "max-w-4xl"
      }`}
    >
      {children}
    </main>
  );
}
