import { toPng } from 'html-to-image';

/**
 * Turn a part of the page (a card with a table) into a PNG and hand it to WhatsApp with as few
 * steps as the browser allows:
 *  - the device's share sheet opens (phones, and Windows/macOS when WhatsApp is installed); WhatsApp
 *    is picked there and the chats chosen inside it ("shared");
 *  - where the browser cannot share files, the picture is copied to the clipboard and WhatsApp Web
 *    opened, so it is pasted into a chat with Ctrl+V ("copied");
 *  - if neither works the PNG is downloaded to be attached by hand ("downloaded").
 * Elements marked data-no-capture (buttons, icons) are left out of the picture.
 */
export type ShareImageResult = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'blocked';

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void>; userAgentData?: { mobile?: boolean } };

export const isMobileDevice = (): boolean => {
  const nav = navigator as ShareNav;
  if (nav.userAgentData?.mobile != null) return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
};

const nextFrame = () => new Promise<void>((resolve) => { let done = false; const go = () => { if (!done) { done = true; resolve(); } }; requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 250); });

/**
 * The picture is always taken in the light theme, whatever theme the page is in: a light table reads
 * better in a chat and prints. While the page is switched to light for the capture, a cover in the
 * page's own colour hides the change, so nothing flashes on screen.
 */
export async function captureElementPng(el: HTMLElement, _dark?: boolean): Promise<Blob> {
  return withLightTheme(() => captureLight(el));
}

/** Pictures of several elements, one after the other, with the page switched to light once. */
export async function captureManyPng(els: HTMLElement[], onProgress?: (done: number) => void): Promise<Blob[]> {
  return withLightTheme(async () => {
    const out: Blob[] = [];
    for (const el of els) { out.push(await captureLight(el)); onProgress?.(out.length); }
    return out;
  });
}

async function withLightTheme<T>(run: () => Promise<T>): Promise<T> {
  const rootEl = document.documentElement;
  const wasDark = rootEl.classList.contains('dark');
  let cover: HTMLDivElement | null = null;
  if (wasDark) {
    cover = document.createElement('div');
    cover.setAttribute('aria-hidden', 'true');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111110;color:#c3c2b7;display:flex;align-items:center;justify-content:center;font:500 14px system-ui,sans-serif';
    cover.textContent = 'Preparing the picture…';
    document.body.appendChild(cover);
    rootEl.classList.remove('dark');
    await nextFrame();
  }
  try {
    return await run();
  } finally {
    if (wasDark) { rootEl.classList.add('dark'); await nextFrame(); }
    cover?.remove();
  }
}

async function captureLight(el: HTMLElement): Promise<Blob> {
  // Tables scroll inside their cards on screen; for the picture the card grows to the table's full
  // width and height so nothing is cut off, then the styles are put back.
  const scrollers = [...el.querySelectorAll<HTMLElement>('.overflow-x-auto, .overflow-auto')];
  const saved = [el, ...scrollers].map((n) => n.getAttribute('style'));
  let width = el.getBoundingClientRect().width;
  for (const n of scrollers) { width = Math.max(width, n.scrollWidth + 2); n.style.overflow = 'visible'; n.style.maxHeight = 'none'; }
  el.style.width = `${Math.ceil(width)}px`;
  el.style.maxWidth = 'none';
  el.style.flex = 'none';
  let dataUrl: string;
  try {
    // Measured once the card has grown: without the scrollbars the table can be wider and taller than
    // it was on screen, and a picture taken at the on-screen size cuts the last column and row.
    await nextFrame();
    for (const n of scrollers) for (const t of n.querySelectorAll<HTMLElement>('table')) width = Math.max(width, t.offsetWidth + 2);
    width = Math.ceil(Math.max(width, el.scrollWidth));
    el.style.width = `${width}px`;
    await nextFrame();
    const height = Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height));
    dataUrl = await toPng(el, {
      pixelRatio: 2,
      width,
      height,
      backgroundColor: '#fcfcfb',
      filter: (node) => !(node instanceof HTMLElement && node.dataset.noCapture != null),
      style: { borderRadius: '0', margin: '0', width: `${width}px`, height: `${height}px`, maxWidth: 'none' },
    });
  } finally {
    [el, ...scrollers].forEach((n, i) => { if (saved[i] == null) n.removeAttribute('style'); else n.setAttribute('style', saved[i] as string); });
  }
  return (await fetch(dataUrl)).blob();
}

async function shareSheet(file: File, title: string): Promise<ShareImageResult | null> {
  const nav = navigator as ShareNav;
  if (!nav.canShare || !nav.share || !nav.canShare({ files: [file] })) return null;
  try { await nav.share({ files: [file], title }); return 'shared'; }
  catch (e) { return (e as Error)?.name === 'AbortError' ? 'cancelled' : null; }
}

export async function copyToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch { return false; }
}

export function download(blob: Blob, filename: string): ShareImageResult {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    return 'downloaded';
  } catch { return 'blocked'; }
}

export async function shareElementAsImage(el: HTMLElement, filename: string, title: string, dark: boolean): Promise<ShareImageResult> {
  const blob = await captureElementPng(el, dark);
  const file = new File([blob], filename, { type: 'image/png' });
  const r = await shareSheet(file, title);
  if (r) return r;
  if (await copyToClipboard(blob)) return 'copied';
  return download(blob, filename);
}

/** Open WhatsApp so the copied picture can be pasted into a chat (web on a computer, app on a phone). */
export function openWhatsApp(): void {
  const url = isMobileDevice() ? 'https://wa.me/' : 'https://web.whatsapp.com/';
  const w = window.open(url, '_blank', 'noopener');
  if (!w) window.location.href = url;
}
