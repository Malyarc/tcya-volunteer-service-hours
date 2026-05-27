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
        brand: {
          50: "#f0fbf6",
          100: "#daf4e7",
          200: "#b5e8cf",
          300: "#86d6b1",
          400: "#52bd8d",
          500: "#2da26f",
          600: "#1f8359",
          700: "#1a6948",
          800: "#175439",
          900: "#13442f",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};
