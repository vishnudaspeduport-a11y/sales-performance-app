/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        // A pale lavender page with white, rounded cards on it; black marks the chosen item, sky blue is the accent.
        surface: { DEFAULT: '#ffffff', dark: '#17171c' },
        plane: { DEFAULT: '#f1eff7', dark: '#0d0d11' },
        ink: { DEFAULT: '#111114', secondary: '#4a4a57', muted: '#8e8e9c', dark: '#f5f5f8', 'dark-secondary': '#c3c3cf' },
        line: { DEFAULT: '#e8e6f0', dark: '#27272f' },
        accent: { DEFAULT: '#2f9bff', dark: '#58aeff', soft: '#e2f1ff', 'soft-dark': '#173b5e' },
        status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,17,20,0.02), 0 12px 30px -18px rgba(60,40,120,0.18)',
        tile: '0 1px 2px rgba(17,17,20,0.02), 0 10px 24px -18px rgba(60,40,120,0.22)',
      },
    },
  },
  plugins: [],
};
