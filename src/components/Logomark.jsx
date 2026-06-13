// Dex logomark: a small constellation in the accent colour. Single source of
// truth for the brand mark across the site (login, registration, landing).
// Matches the logomark used in the desktop app's sign-in screen.
export default function Logomark({ size = 40, color = 'currentColor', style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      style={{ color, display: 'block', ...style }}
    >
      <g stroke="currentColor" strokeWidth="1.3" opacity="0.45">
        <line x1="8" y1="29" x2="20" y2="14" />
        <line x1="20" y1="14" x2="32" y2="24" />
        <line x1="20" y1="14" x2="25" y2="6" />
      </g>
      <g fill="currentColor">
        <circle cx="20" cy="14" r="3.1" />
        <circle cx="8" cy="29" r="2" />
        <circle cx="32" cy="24" r="2.2" />
        <circle cx="25" cy="6" r="1.5" opacity="0.7" />
      </g>
    </svg>
  );
}
