/**
 * Stable categorical colours: the same executive always gets the same colour in
 * every chart (identity follows the entity, not its rank).
 */
const PALETTE_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#0e9aa7', '#a0522d', '#6d8b00', '#b8409f'];
const PALETTE_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#22b3c2', '#c0714a', '#8fb31a', '#d15bb8'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function colorForKey(key: string, dark: boolean): string {
  const p = dark ? PALETTE_DARK : PALETTE_LIGHT;
  return p[hash(key) % p.length];
}

/** Colour by position (for small fixed sets such as weekdays). */
export function colorForIndex(i: number, dark: boolean): string {
  const p = dark ? PALETTE_DARK : PALETTE_LIGHT;
  return p[((i % p.length) + p.length) % p.length];
}
