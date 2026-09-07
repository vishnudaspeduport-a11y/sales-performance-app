/**
 * Eduport mark: orange "e" with a black graduation cap. Vector recreation of the
 * brand logo so it stays crisp at any size and in both themes.
 * To use the original artwork instead, drop `public/eduport-logo.svg` (or .png)
 * into the repo and replace the SVG below with <img src="/eduport-logo.svg" />.
 */
export const EDUPORT_ORANGE = '#F47A20';

export function EduportLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Eduport" className={className}>
      {/* the "e" */}
      <circle cx="58" cy="60" r="30" fill="none" stroke={EDUPORT_ORANGE} strokeWidth="14" strokeLinecap="butt" strokeDasharray="150 40" transform="rotate(-25 58 60)" />
      <rect x="35" y="55" width="52" height="12" rx="2" fill={EDUPORT_ORANGE} />
      {/* mortarboard */}
      <g className="fill-[#1f1f1f] dark:fill-[#f4f4f2]">
        <polygon points="8,34 46,16 84,32 46,50" />
        <path d="M26 42 v14 c0 6 9 10 20 10 s20-4 20-10 v-14 c-6 4-13 6-20 6 s-14-2-20-6z" />
        <rect x="16" y="36" width="2.5" height="26" />
        <circle cx="17.2" cy="64" r="3" />
      </g>
    </svg>
  );
}

/** Data URI of the mark, for the favicon. Keep in sync with the SVG above. */
export const EDUPORT_FAVICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="58" cy="60" r="30" fill="none" stroke="${EDUPORT_ORANGE}" stroke-width="14" stroke-dasharray="150 40" transform="rotate(-25 58 60)"/><rect x="35" y="55" width="52" height="12" rx="2" fill="${EDUPORT_ORANGE}"/><g fill="#1f1f1f"><polygon points="8,34 46,16 84,32 46,50"/><path d="M26 42 v14 c0 6 9 10 20 10 s20-4 20-10 v-14 c-6 4-13 6-20 6 s-14-2-20-6z"/><rect x="16" y="36" width="2.5" height="26"/><circle cx="17.2" cy="64" r="3"/></g></svg>`,
  );
