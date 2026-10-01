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
        // A soft blue-grey page with white, rounded cards on it.
        surface: { DEFAULT: '#ffffff', dark: '#161a22' },
        plane: { DEFAULT: '#eef2f7', dark: '#0c0f14' },
        ink: { DEFAULT: '#0f172a', secondary: '#4b5565', muted: '#8b95a7', dark: '#f3f5f9', 'dark-secondary': '#c0c7d4' },
        line: { DEFAULT: '#e5e9f1', dark: '#262c37' },
        accent: { DEFAULT: '#2f7df6', dark: '#4d8ff7', soft: '#e4edff', 'soft-dark': '#1b3a6b' },
        status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.03), 0 10px 28px -14px rgba(15,23,42,0.14)',
        tile: '0 14px 28px -14px rgba(15,23,42,0.35)',
      },
    },
  },
  plugins: [],
};
