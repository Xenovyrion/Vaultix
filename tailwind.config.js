/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#08080f",
          secondary: "#0d1117",
          card: "#111827",
          hover: "#1a2233",
        },
        accent: {
          DEFAULT: "#3b82f6",
          hover: "#2563eb",
          dim: "rgba(59,130,246,0.12)",
          purple: "#7c3aed",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.07)",
          light: "rgba(255,255,255,0.12)",
        },
        text: {
          primary: "#f1f5f9",
          secondary: "#94a3b8",
          muted: "#64748b",
        },
        status: {
          ok: "#22c55e",
          warn: "#f59e0b",
          err: "#ef4444",
          info: "#60a5fa",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
