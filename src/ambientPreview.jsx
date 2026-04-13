import React from 'react';
import ReactDOM from 'react-dom/client';
import HeroConstellationAmbient from './components/HeroConstellationAmbient';
import './ambientPreview.css';

function AmbientPreview() {
  return (
    <main className="ambient-preview">
      <section className="ambient-preview__frame">
        <div className="ambient-preview__hero">
          <HeroConstellationAmbient />

          <div className="ambient-preview__content">
            <div className="ambient-preview__topline">Constellation Ambient Study</div>
            <h1 className="ambient-preview__title">
              Become AI
              <br />
              fluent by
              <br />
              doing.
            </h1>
            <p className="ambient-preview__body">
              Preview-only composition for the Hadex hero. The background should feel
              celestial, local-first, and atmospheric without ever competing with the
              headline or CTA.
            </p>
          </div>

          <div className="ambient-preview__footer">
            <a className="ambient-preview__cta" href="#">
              Get Started Free
              <span className="ambient-preview__cta-arrow">→</span>
            </a>

            <div className="ambient-preview__note">
              Free forever for individuals.
              <br />
              Local-first. Model-agnostic.
            </div>
          </div>

          <div className="ambient-preview__hint">
            Tuned for bottom-right atmosphere only.
            <br />
            Not a literal illustration.
          </div>
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AmbientPreview />
  </React.StrictMode>,
);
