import type { MetricFormat } from '../config/metrics';

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatNumber(n: number | null | undefined, digits: 0 | 1 = 0): string {
  if (n == null || !isFinite(n)) return '–';
  return (digits === 0 ? nf0 : nf1).format(n);
}

/** Seconds → "8h 42m", "4m 32s", "45s". Never shows raw seconds for large values. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '–';
  const s = Math.round(Math.abs(seconds));
  const sign = seconds < 0 ? '-' : '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}h ${m}m`;
  if (m > 0) return `${sign}${m}m ${sec}s`;
  return `${sign}${sec}s`;
}

/** Seconds → compact axis label ("8.5h", "42m"). */
export function formatDurationShort(seconds: number): string {
  if (!isFinite(seconds)) return '';
  if (seconds >= 3600) return `${nf1.format(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds)}s`;
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !isFinite(ratio)) return '–';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMetric(value: number | null | undefined, format: MetricFormat): string {
  if (value == null || !isFinite(value)) return '–';
  switch (format) {
    case 'seconds': return formatDuration(value);
    case 'percent': return formatPercent(value);
    case 'score': return `${Math.round(value)}`;
    case 'decimal': return formatNumber(value, 1);
    default: return formatNumber(value, 0);
  }
}

/** Axis tick formatter per metric format. */
export function formatAxis(value: number, format: MetricFormat): string {
  if (!isFinite(value)) return '';
  switch (format) {
    case 'seconds': return formatDurationShort(value);
    case 'percent': return `${Math.round(value * 100)}%`;
    case 'score': return `${Math.round(value)}`;
    case 'decimal': return nf1.format(value);
    default:
      if (Math.abs(value) >= 1000) return `${nf1.format(value / 1000)}k`;
      return nf0.format(value);
  }
}

/** "+8.4%", "−3.1%", or "+2.3 pp" for rates. */
export function formatDelta(deltaPct: number | null, isRate: boolean, deltaAbs?: number | null): string {
  if (isRate) {
    if (deltaAbs == null || !isFinite(deltaAbs)) return '–';
    const pp = deltaAbs * 100;
    return `${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)} pp`;
  }
  if (deltaPct == null || !isFinite(deltaPct)) return '–';
  return `${deltaPct >= 0 ? '+' : '−'}${Math.abs(deltaPct * 100).toFixed(1)}%`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
