import React from 'react';

const STAR_NODES = [
  { x: 216, y: 180, r: 3.2, opacity: 0.34 },
  { x: 262, y: 154, r: 4.2, opacity: 0.78 },
  { x: 308, y: 172, r: 2.8, opacity: 0.42 },
  { x: 338, y: 132, r: 2.6, opacity: 0.3 },
  { x: 288, y: 104, r: 2.4, opacity: 0.26 },
  { x: 240, y: 208, r: 2.6, opacity: 0.24 },
  { x: 348, y: 196, r: 2.2, opacity: 0.18 },
  { x: 390, y: 150, r: 1.8, opacity: 0.14 },
];

const STAR_LINES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [1, 4],
  [0, 5],
  [2, 6],
];

export default function HeroConstellationAmbient({
  className = '',
  style = {},
  primaryColor = '#ff4fa6',
}) {
  const containerStyle = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0,
    ...style,
  };

  return (
    <div
      aria-hidden="true"
      className={className}
      style={containerStyle}
    >
      <div
        style={{
          position: 'absolute',
          right: -180,
          bottom: -160,
          width: 720,
          height: 540,
          borderRadius: '999px',
          background:
            'radial-gradient(ellipse at 46% 50%, rgba(255, 79, 166, 0.18) 0%, rgba(255, 79, 166, 0.08) 24%, rgba(255, 79, 166, 0.025) 48%, transparent 74%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          right: -10,
          bottom: -30,
          width: 420,
          height: 280,
          borderRadius: '999px',
          background:
            'radial-gradient(ellipse at 48% 52%, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.016) 32%, transparent 64%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          right: 150,
          bottom: 55,
          width: 230,
          height: 160,
          borderRadius: '999px',
          background:
            'radial-gradient(ellipse at 55% 58%, rgba(255, 79, 166, 0.065) 0%, transparent 72%)',
        }}
      />

      <svg
        viewBox="0 0 440 280"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 430,
          height: 280,
          opacity: 0.58,
        }}
      >
        <defs>
          <linearGradient id="hero-ambient-line" x1="200" y1="220" x2="420" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(255,79,166,0)" />
            <stop offset="18%" stopColor="rgba(255,79,166,0.06)" />
            <stop offset="70%" stopColor="rgba(255,79,166,0.18)" />
            <stop offset="100%" stopColor="rgba(255,79,166,0.12)" />
          </linearGradient>
          <radialGradient id="hero-ambient-star" cx="0" cy="0" r="1" gradientTransform="translate(0.5 0.5) scale(0.5)" gradientUnits="objectBoundingBox">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="28%" stopColor={primaryColor} />
            <stop offset="100%" stopColor="rgba(255,79,166,0)" />
          </radialGradient>
          <linearGradient id="hero-ambient-mask" x1="30" y1="40" x2="365" y2="240" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="36%" stopColor="white" stopOpacity="0.18" />
            <stop offset="62%" stopColor="white" stopOpacity="0.72" />
            <stop offset="100%" stopColor="white" stopOpacity="1" />
          </linearGradient>
          <mask id="hero-ambient-fade">
            <rect width="440" height="280" fill="url(#hero-ambient-mask)" />
          </mask>
        </defs>

        <g mask="url(#hero-ambient-fade)">
          {STAR_LINES.map(([fromIndex, toIndex], index) => {
            const from = STAR_NODES[fromIndex];
            const to = STAR_NODES[toIndex];
            return (
              <line
                key={`line-${index}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="url(#hero-ambient-line)"
                strokeWidth="0.9"
                strokeLinecap="round"
              />
            );
          })}

          {STAR_NODES.map((node, index) => (
            <g key={`star-${index}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r * 3.8}
                fill="url(#hero-ambient-star)"
                opacity={node.opacity * 0.5}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={primaryColor}
                opacity={node.opacity}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
