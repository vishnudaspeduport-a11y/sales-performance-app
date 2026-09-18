import { toPng } from 'html-to-image';

/**
 * Turn a part of the page (a card with a table) into a PNG and hand it to WhatsApp or any app
 * through the device's share sheet; where sharing files is not supported the PNG is downloaded
 * so it can be attached by hand. Elements marked data-no-capture (buttons, icons) are left out.
 */
export type ShareImageResult = 'shared' | 'downloaded' | 'cancelled' | 'blocked';

export async function shareElementAsImage(el: HTMLElement, filename: string, title: string, dark: boolean): Promise<ShareImageResult> {
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
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'shared'; }
    catch (e) { if ((e as Error)?.name === 'AbortError') return 'cancelled'; }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    return 'downloaded';
  } catch { return 'blocked'; }
}
