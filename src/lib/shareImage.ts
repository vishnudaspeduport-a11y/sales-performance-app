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

export async function captureElementPng(el: HTMLElement, dark: boolean): Promise<Blob> {
  // Tables scroll inside their cards on screen; for the picture the card grows to the table's full
  // width and height so nothing is cut off, then the styles are put back.
  const scrollers = [...el.querySelectorAll<HTMLElement>('.overflow-x-auto, .overflow-auto')];
  const saved = [el, ...scrollers].map((n) => n.getAttribute('style'));
  let width = el.getBoundingClientRect().width;
  for (const n of scrollers) { width = Math.max(width, n.scrollWidth + 2); n.style.overflow = 'visible'; n.style.maxHeight = 'none'; }
  el.style.width = `${Math.ceil(width)}px`;
  let dataUrl: string;
  try {
    dataUrl = await toPng(el, {
      pixelRatio: 2,
      backgroundColor: dark ? '#1a1a19' : '#fcfcfb',
      filter: (node) => !(node instanceof HTMLElement && node.dataset.noCapture != null),
      style: { borderRadius: '0' },
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

function download(blob: Blob, filename: string): ShareImageResult {
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
