/**
 * A small PDF writer for pictures: the pictures are placed one below another on A4 pages, each at
 * the full width of the page, a picture that does not fit on the rest of a page starting the next
 * one. Every page carries a title line on top and "Page n of N" at the bottom.
 * Written by hand (JPEG pictures, the standard Helvetica fonts) so no library is needed.
 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const HEAD = 22; // room for the title line
const FOOT = 16; // room for the page number
const GAP = 10; // between two pictures

interface Jpeg { w: number; h: number; data: Uint8Array }

async function toJpeg(picture: Blob): Promise<Jpeg> {
  const bmp = await createImageBitmap(picture);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!jpeg) throw new Error('no jpeg');
  return { w: bmp.width, h: bmp.height, data: new Uint8Array(await jpeg.arrayBuffer()) };
}

/** Text for a PDF string: plain ASCII, with the three special characters escaped. */
const pdfText = (s: string) => s.replace(/[·•–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export async function picturesToPdf(pictures: Blob[], title: string): Promise<{ pdf: Blob; pages: number }> {
  const images: Jpeg[] = [];
  for (const p of pictures) images.push(await toJpeg(p));

  // Where each picture goes. PDF coordinates start at the bottom left of the page.
  const width = PAGE_W - 2 * MARGIN;
  const top = PAGE_H - MARGIN - HEAD;
  const bottom = MARGIN + FOOT;
  const pages: { image: number; x: number; y: number; w: number; h: number }[][] = [[]];
  let y = top;
  images.forEach((im, i) => {
    let w = width; let h = (im.h * width) / im.w;
    if (h > top - bottom) { h = top - bottom; w = (im.w * h) / im.h; } // taller than a page: shrink to fit
    if (y - h < bottom && pages[pages.length - 1].length) { pages.push([]); y = top; }
    pages[pages.length - 1].push({ image: i, x: MARGIN + (width - w) / 2, y: y - h, w, h });
    y -= h + GAP;
  });

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (d: string | Uint8Array) => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); pos += u.length; };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };

  // Object numbers: 1 catalog, 2 page list, 3 and 4 fonts, then the pictures, then a page and its content each.
  const imageObj = (i: number) => 5 + i;
  const pageObj = (k: number) => 5 + images.length + 2 * k;
  const total = 4 + images.length + 2 * pages.length;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${pageObj(k)} 0 R`).join(' ')}] >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  images.forEach((im, i) => obj(imageObj(i), `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>`, im.data));
  pages.forEach((items, k) => {
    const content = [
      `BT /F2 11 Tf ${num(MARGIN)} ${num(PAGE_H - MARGIN - 11)} Td (${pdfText(title)}) Tj ET`,
      ...items.map((it) => `q ${num(it.w)} 0 0 ${num(it.h)} ${num(it.x)} ${num(it.y)} cm /Im${it.image} Do Q`),
      `BT /F1 8 Tf ${num(MARGIN)} ${num(MARGIN - 4)} Td (Page ${k + 1} of ${pages.length}) Tj ET`,
    ].join('\n');
    const stream = enc.encode(content);
    obj(pageObj(k), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${items.map((it) => `/Im${it.image} ${imageObj(it.image)} 0 R`).join(' ')} >> >> /Contents ${pageObj(k) + 1} 0 R >>`);
    obj(pageObj(k) + 1, `<< /Length ${stream.length} >>`, stream);
  });

  const xref = pos;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return { pdf: new Blob(parts as BlobPart[], { type: 'application/pdf' }), pages: pages.length };
}
