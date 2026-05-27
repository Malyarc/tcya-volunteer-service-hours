/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        // Tzu Chi-inspired navy blue palette ("blue sky" 藍天).
        // 700 is the primary brand shade — a deep, calming navy.
        brand: {
          50: "#eef4fb",
          100: "#d6e5f3",
          200: "#aecbe7",
          300: "#7ea9d5",
          400: "#4f86bf",
          500: "#2f68a5",
          600: "#1d518a",
          700: "#143e6e",
          800: "#0f2f55",
          900: "#0a2140",
        },
        // Warm gold accent used sparingly for highlights / secondary CTAs.
        accent: {
          50: "#fff8e6",
          100: "#ffeec0",
          200: "#fcdc88",
          300: "#f5c558",
          400: "#e9ac34",
          500: "#cf8e1d",
          600: "#a36e15",
          700: "#7c5311",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};
