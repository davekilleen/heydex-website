import React from 'react';
import ReactDOM from 'react-dom/client';
import './paperHeroVariantDPreview.css';

function DexStar({ className = '', size = 28, strokeWidth = 1.8 }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 2.5V25.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square" />
      <path d="M2.5 14H25.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square" />
      <path d="M5.9 5.9L22.1 22.1" stroke="currentColor" strokeWidth={strokeWidth - 0.2} strokeLinecap="square" />
      <path d="M22.1 5.9L5.9 22.1" stroke="currentColor" strokeWidth={strokeWidth - 0.2} strokeLinecap="square" />
    </svg>
  );
}

const clusterA = [
  { x: 150, y: 266, size: 10, opacity: 0.16 },
  { x: 188, y: 206, size: 20, opacity: 0.92 },
  { x: 226, y: 154, size: 15, opacity: 0.36 },
  { x: 266, y: 104, size: 12, opacity: 0.2 },
  { x: 270, y: 228, size: 11, opacity: 0.18 },
];

const clusterALines = [
  [0, 1],
  [1, 2],
  [2, 3],
  [1, 4],
];

const clusterB = [
  { x: 78, y: 150, size: 12, opacity: 0.14 },
  { x: 126, y: 122, size: 16, opacity: 0.32 },
  { x: 182, y: 86, size: 10, opacity: 0.18 },
  { x: 198, y: 168, size: 10, opacity: 0.16 },
];

const clusterBLines = [
  [0, 1],
  [1, 2],
  [1, 3],
];

function Cluster({ className, nodes, lines, viewBox }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {lines.map(([fromIndex, toIndex], index) => {
        const from = nodes[fromIndex];
        const to = nodes[toIndex];
        return (
          <line
            key={`line-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="rgba(255,79,166,0.11)"
            strokeWidth="1.1"
          />
        );
      })}

      {nodes.map((node, index) => (
        <g
          key={`star-${index}`}
          transform={`translate(${node.x - node.size / 2} ${node.y - node.size / 2})`}
          opacity={node.opacity}
        >
          <DexStar size={node.size} strokeWidth={node.size >= 18 ? 1.7 : 1.12} />
        </g>
      ))}
    </svg>
  );
}

function GitHubPill({ label }) {
  return (
    <div className="paper-hero-vd__pill">
      <span className="paper-hero-vd__pill-dot" />
      <span>{label}</span>
    </div>
  );
}

function PaperHeroVariantDPreview() {
  return (
    <main className="paper-hero-vd">
      <section className="paper-hero-vd__frame">
        <header className="paper-hero-vd__nav">
          <div className="paper-hero-vd__brand">
            <DexStar className="paper-hero-vd__brand-star" size={28} strokeWidth={1.8} />
            <span className="paper-hero-vd__brand-word">Dex</span>
          </div>

          <nav className="paper-hero-vd__center-nav" aria-label="Primary">
            <a href="#how-it-works">How it works</a>
            <a href="#diffs">Diffs</a>
            <a href="#teams">Teams</a>
          </nav>

          <div className="paper-hero-vd__actions">
            <div className="paper-hero-vd__proof">
              <GitHubPill label="298 stars" />
              <GitHubPill label="15 forks" />
            </div>
            <a href="#get-started" className="paper-hero-vd__nav-cta">
              <span>Get Started Free</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </header>

        <section className="paper-hero-vd__hero">
          <div className="paper-hero-vd__content">
            <h1 className="paper-hero-vd__title">
              Become AI
              <br />
              fluent by
              <br />
              doing.
            </h1>

            <p className="paper-hero-vd__body">
              Dex helps you work better with AI, understand how it works, and
              make it your own.
            </p>

            <div className="paper-hero-vd__meta">
              <a href="#get-started" className="paper-hero-vd__hero-cta">
                <span>Get Started Free</span>
                <span aria-hidden="true">→</span>
              </a>

              <div className="paper-hero-vd__note">
                <div>Free forever for individuals.</div>
                <div>Local-first. Model-agnostic.</div>
              </div>
            </div>

            <div className="paper-hero-vd__tagline">
              The internet has users. Dex has diffs.
            </div>
          </div>

          <div className="paper-hero-vd__ambient" aria-hidden="true">
            <div className="paper-hero-vd__glow paper-hero-vd__glow--right" />
            <div className="paper-hero-vd__glow paper-hero-vd__glow--mid" />
            <Cluster
              className="paper-hero-vd__cluster paper-hero-vd__cluster--main"
              nodes={clusterA}
              lines={clusterALines}
              viewBox="0 0 360 340"
            />
            <Cluster
              className="paper-hero-vd__cluster paper-hero-vd__cluster--secondary"
              nodes={clusterB}
              lines={clusterBLines}
              viewBox="0 0 250 210"
            />
          </div>
        </section>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PaperHeroVariantDPreview />
  </React.StrictMode>,
);
