import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  /** chart colours for the active theme */
  chart: ChartColors;
}

export interface ChartColors {
  series: string[];
  ink: string;
  inkMuted: string;
  grid: string;
  axis: string;
  surface: string;
  status: { good: string; warning: string; serious: string; critical: string };
  seq: string[];
}

const LIGHT: ChartColors = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  ink: '#0b0b0b', inkMuted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
};
const DARK: ChartColors = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  ink: '#ffffff', inkMuted: '#898781', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  seq: ['#184f95', '#1c5cab', '#256abf', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6'],
};

const ThemeContext = createContext<ThemeState | null>(null);
const KEY = 'sales-dashboard-theme';

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  try {
    // Hosts that stamp an explicit theme on the root element win over the OS setting.
    const stamped = document.documentElement.getAttribute('data-theme');
    if (stamped === 'dark' || stamped === 'light') return stamped;
  } catch { /* ignore */ }
  try { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, toggle, chart: theme === 'dark' ? DARK : LIGHT }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
