import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // `sm` starts at 600px instead of Tailwind's 640px so the iPhone Duo's
    // unfolded inner display (~626pt wide) gets the roomier tablet-style layout
    // rather than a stretched phone column. Regular phones top out around 440pt,
    // so nothing changes for them.
    screens: {
      sm: "600px",
      md: defaultTheme.screens.md,
      lg: defaultTheme.screens.lg,
      xl: defaultTheme.screens.xl,
      "2xl": defaultTheme.screens["2xl"],
      // Squat viewports: the iPhone Duo's folded outer display (~678pt tall) and
      // any phone held in landscape. Chrome shrinks here so content gets the room.
      short: { raw: "(max-height: 720px)" },
    },
    extend: {
      colors: {
        brand: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
      },
    },
  },
  plugins: [],
};
export default config;
