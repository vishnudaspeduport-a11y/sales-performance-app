/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        surface: { DEFAULT: '#fcfcfb', dark: '#1a1a19' },
        plane: { DEFAULT: '#f4f4f2', dark: '#0f0f0e' },
        ink: { DEFAULT: '#0b0b0b', secondary: '#52514e', muted: '#898781', dark: '#ffffff', 'dark-secondary': '#c3c2b7' },
        line: { DEFAULT: '#e1e0d9', dark: '#2c2c2a' },
        accent: { DEFAULT: '#2a78d6', dark: '#3987e5', soft: '#cde2fb', 'soft-dark': '#184f95' },
        status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 3px rgba(11,11,11,0.06)',
      },
    },
  },
  plugins: [],
};
