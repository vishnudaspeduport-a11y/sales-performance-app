function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const r of rows) lines.push(r.map(escapeCell).join(','));
  return `﻿${lines.join('\r\n')}`;
}

interface DownloadsNamespace { save: (req: { filename: string; data: string }) => Promise<unknown> }
interface ClaudeRuntime { use: (name: string) => Promise<DownloadsNamespace | null> }

/**
 * Trigger a download. Hosts that mediate saves (the claude.ai artifact viewer)
 * are used when present; otherwise a plain anchor download.
 * Returns 'saved' | 'declined' | 'blocked'.
 */
export async function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): Promise<'saved' | 'declined' | 'blocked'> {
  const runtime = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (runtime && typeof runtime.use === 'function') {
    try {
      const downloads = await runtime.use('downloads');
      if (downloads) {
        try { await downloads.save({ filename, data: text }); return 'saved'; }
        catch (e) { return (e as { code?: string })?.code === 'declined' ? 'declined' : 'blocked'; }
      }
    } catch { /* fall through to anchor download */ }
  }
  return anchorDownload(filename, text, mime) ? 'saved' : 'blocked';
}

function anchorDownload(filename: string, text: string, mime: string): boolean {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    return true;
  } catch {
    return false;
  }
}
