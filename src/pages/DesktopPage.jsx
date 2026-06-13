import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import styles from './DesktopPage.module.css';

const DOWNLOAD_HREF = '/desktop/downloads/Dex-1.0.0-arm64.dmg';
const HELP_HOME_HREF = '/desktop/help/';
const RELEASE_NOTES_HREF = '/desktop/help/releases.html';
const FEEDBACK_HREF = '/desktop/help/giving-feedback.html';

const feedbackSteps = [
  {
    label: 'Annotate',
    src: '/desktop/help/screenshots/feedback-annotate.png',
    alt: 'Feedback annotation screenshot',
  },
  {
    label: 'Review what you send',
    src: '/desktop/help/screenshots/feedback-preview.png',
    alt: 'Feedback preview screenshot',
  },
  {
    label: 'Dave triages',
    src: '/desktop/help/screenshots/feedback-loop.png',
    alt: 'Feedback triage screenshot',
  },
  {
    label: 'See it ship',
    src: '/desktop/help/screenshots/feedback-status.png',
    alt: 'Feedback status screenshot',
  },
];

const gettingStartedSteps = [
  'Download the DMG and open it. The build is not yet signed, so the first launch is right click, then Open.',
  'Sign in with Google. Your account is your identity in the beta.',
  'Answer a few setup questions. Dex builds your workspace around your role and your goals.',
  'Read the guide. Ten minutes in the help pages saves you an hour of wondering.',
];

function getFirstName(user) {
  const displayName = user?.displayName || user?.name || '';
  const firstName = displayName.trim().split(/\s+/)[0];
  return firstName || '';
}

function Label({ children }) {
  return <div className={styles.label}>{children}</div>;
}

function Constellation() {
  return (
    <svg className={styles.constellation} viewBox="0 0 470 388" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="desktop-glow" cx="66%" cy="78%" r="62%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.20" />
          <stop offset="34%" stopColor="currentColor" stopOpacity="0.07" />
          <stop offset="68%" stopColor="currentColor" stopOpacity="0.02" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <filter id="desktop-bloom" x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="3.6" />
        </filter>
      </defs>
      <rect x="0" y="0" width="470" height="388" fill="url(#desktop-glow)" />
      <g stroke="currentColor" strokeWidth="1" opacity="0.22">
        <line x1="156" y1="320" x2="240" y2="258" />
        <line x1="240" y1="258" x2="320" y2="294" />
        <line x1="320" y1="294" x2="382" y2="216" />
        <line x1="382" y1="216" x2="440" y2="256" />
        <line x1="240" y1="258" x2="276" y2="152" />
        <line x1="276" y1="152" x2="364" y2="122" />
      </g>
      <g fill="currentColor" opacity="0.5" filter="url(#desktop-bloom)">
        <circle cx="240" cy="258" r="4.6" />
        <circle cx="382" cy="216" r="4.1" />
        <circle cx="320" cy="294" r="3.2" />
      </g>
      <g fill="currentColor" opacity="0.92">
        <circle cx="156" cy="320" r="2.4" />
        <circle cx="240" cy="258" r="2.9" />
        <circle cx="320" cy="294" r="2.1" />
        <circle cx="382" cy="216" r="2.5" />
        <circle cx="440" cy="256" r="2" />
      </g>
      <g fill="currentColor" opacity="0.4">
        <circle cx="276" cy="152" r="1.5" />
        <circle cx="364" cy="122" r="1.3" />
        <circle cx="202" cy="210" r="1.1" />
        <circle cx="416" cy="176" r="1.1" />
      </g>
    </svg>
  );
}

export default function DesktopPage() {
  const [lightbox, setLightbox] = useState(null);
  const currentUser = useQuery(api.users.me);
  const firstName = getFirstName(currentUser);
  const heroSubcopy = `${firstName ? `Welcome, ${firstName}. ` : ''}Your day in one brief, your promises tracked, your follow-ups drafted before you ask. The chief of staff that lived in a terminal now lives on your desktop.`;

  useEffect(() => {
    // Invite-only page: keep it out of search indexes as a second layer behind the auth gate.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (lightbox === null) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setLightbox(null);
      else if (event.key === 'ArrowRight') setLightbox((i) => (i + 1) % feedbackSteps.length);
      else if (event.key === 'ArrowLeft') setLightbox((i) => (i - 1 + feedbackSteps.length) % feedbackSteps.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <main className={styles.page}>
      <Constellation />

      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="desktop-title">
        <div className={styles.heroCopy}>
          <Label>PRIVATE BETA</Label>
          <h1 id="desktop-title">Dex, out of the terminal.</h1>
          <p>{heroSubcopy}</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href={DOWNLOAD_HREF}>
              <span>Download for Mac</span>
              <span className={styles.buttonMeta}>v1.0.0 · Apple Silicon · 166 MB</span>
            </a>
          </div>
          <div className={styles.heroLinks}>
            <a href={HELP_HOME_HREF}>New here? Read the guide</a>
            <span aria-hidden="true">·</span>
            <a href={RELEASE_NOTES_HREF}>What changed? Release notes</a>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.copyGrid}`} aria-labelledby="desktop-point">
        <div>
          <Label>THE POINT</Label>
          <h2 id="desktop-point">Built for the people the terminal left out.</h2>
        </div>
        <div className={styles.bodyStack}>
          <p>
            The people who most need a chief of staff are the ones who never had time to learn a
            terminal: sellers, product leads, founders, operators whose day is meetings and
            decisions, not code.
          </p>
          <p>
            So Dex left the command line. One install, a five-minute setup, and it starts learning
            how you work. No terminal, no configuration files, no jargon.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="desktop-builder">
        <div className={styles.letterCard}>
          <Label>FROM THE BUILDER</Label>
          <div className={styles.letterBody} id="desktop-builder">
            <p>
              I have been building Dex nights and weekends for a long time, and this is the moment I
              have been working toward: putting it in the hands of people who do not care how it
              works, only that it does.
            </p>
            <p>
              You are getting the very first desktop build. Some edges are still rough, and honestly,
              that is why you are here. Every piece of feedback you send lands directly with me. I
              read all of it, I triage all of it, and you see my replies and the status of everything
              you raise inside the app itself.
            </p>
            <p>Thank you for being early. It means more than you know.</p>
            <p className={styles.signature}>Dave</p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.stepsSection}`} aria-labelledby="desktop-start">
        <div>
          <Label>GET STARTED</Label>
          <h2 id="desktop-start">Four steps and you&apos;re running.</h2>
        </div>
        <div>
          <ol className={styles.stepsList}>
            {gettingStartedSteps.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
          <a className={styles.outlineButton} href={HELP_HOME_HREF}>
            Open the guide
          </a>
        </div>
      </section>

      <section className={`${styles.section} ${styles.feedbackSection}`} aria-labelledby="desktop-feedback">
        <div className={styles.feedbackIntro}>
          <Label>THE FEEDBACK LOOP</Label>
          <h2 id="desktop-feedback">Annotate anything. Watch it become a fix.</h2>
          <p>
            There is a feedback toolbar inside the app. Point at anything that confuses or delights
            you and write what you think. Before anything is sent you see exactly what will be
            shared, and you can remove whatever you want. After you send it, AI groups your notes
            with other testers&apos; reports, I review every one, and real issues go on the roadmap.
            When something you raised ships, the app tells you.
          </p>
        </div>
        <div className={styles.visualStrip}>
          {feedbackSteps.map((step, index) => (
            <figure key={step.label} className={styles.visualItem}>
              <button
                type="button"
                className={styles.imageFrame}
                onClick={() => setLightbox(index)}
                aria-label={`Expand screenshot: ${step.label}`}
              >
                <img src={step.src} alt={step.alt} loading="lazy" />
              </button>
              <figcaption>{step.label}</figcaption>
            </figure>
          ))}
        </div>
        <a className={styles.secondaryLink} href={FEEDBACK_HREF}>
          How to give feedback
        </a>
      </section>

      <footer className={styles.footer}>
        <a href={RELEASE_NOTES_HREF}>Release notes</a>
        <span aria-hidden="true">·</span>
        <a href={HELP_HOME_HREF}>Help home</a>
        <span aria-hidden="true">·</span>
        <span>Private beta. Please do not share the download link.</span>
        <span aria-hidden="true">·</span>
        <a href="/">heydex.ai</a>
      </footer>

      {lightbox !== null && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Feedback screenshots"
          onClick={() => setLightbox(null)}
        >
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Close">
            ✕
          </button>
          <button
            className={styles.lightboxNav}
            onClick={(event) => {
              event.stopPropagation();
              setLightbox((i) => (i - 1 + feedbackSteps.length) % feedbackSteps.length);
            }}
            aria-label="Previous screenshot"
          >
            ‹
          </button>
          <figure className={styles.lightboxFigure} onClick={(event) => event.stopPropagation()}>
            <img src={feedbackSteps[lightbox].src} alt={feedbackSteps[lightbox].alt} />
            <figcaption>
              {feedbackSteps[lightbox].label} · {lightbox + 1} / {feedbackSteps.length}
            </figcaption>
          </figure>
          <button
            className={styles.lightboxNav}
            onClick={(event) => {
              event.stopPropagation();
              setLightbox((i) => (i + 1) % feedbackSteps.length);
            }}
            aria-label="Next screenshot"
          >
            ›
          </button>
        </div>
      )}
    </main>
  );
}
