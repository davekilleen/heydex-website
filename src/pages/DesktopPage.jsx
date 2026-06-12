import { useConvexAuth, useQuery } from 'convex/react';
import { useEffect } from 'react';
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
  'Sign in with Google or Microsoft. Your account is your identity in the beta.',
  'Answer a few setup questions. Dex builds your workspace around your role and your goals.',
  'Read the guide. Ten minutes in the help pages will save you an hour of wondering.',
];

function getFirstName(user) {
  const displayName = user?.displayName || user?.name || '';
  const firstName = displayName.trim().split(/\s+/)[0];
  return firstName || '';
}

function Label({ children }) {
  return <div className={styles.label}>{children}</div>;
}

function LoadingState() {
  return (
    <main className={styles.loadingPage} aria-busy="true">
      <p>Checking your invite</p>
    </main>
  );
}

export default function DesktopPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(api.users.me);
  const userIsLoading = isAuthenticated && currentUser === undefined;
  const firstName = getFirstName(currentUser);
  const heroSubcopy = firstName
    ? `Your AI chief of staff has lived in a command line. Starting today, it lives on your desktop. Welcome, ${firstName}. You are one of the first people in the world to use it.`
    : 'Your AI chief of staff has lived in a command line. Starting today, it lives on your desktop. You are one of the first people in the world to use it.';

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    window.location.href = '/desktop/connect/?return=/desktop/';
  }, [isAuthenticated, isLoading]);

  if (isLoading || !isAuthenticated || userIsLoading) {
    return <LoadingState />;
  }

  return (
    <main className={styles.page}>
      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="desktop-title">
        <div className={styles.heroCopy}>
          <Label>PRIVATE BETA</Label>
          <h1 id="desktop-title">Dex, out of the terminal.</h1>
          <p>{heroSubcopy}</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href={DOWNLOAD_HREF}>
              <span>Download for Mac</span>
              <span className={styles.buttonMeta}>v1.0.0 · Apple Silicon · 136 MB</span>
            </a>
            <a className={styles.outlineButton} href={HELP_HOME_HREF}>
              Read the guide first
            </a>
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
            Dex began as a tool for people who live in terminals. It planned the day, prepped
            the meetings, drafted the follow-ups, and remembered everything, but you had to
            speak its language to get any of it.
          </p>
          <p>
            That was always backwards. The people who need a chief of staff most are not the
            ones who know what a shell is. They are sellers, product leads, founders, and
            operators whose day is meetings and decisions, not code. The plan from the start
            was to meet them where they work.
          </p>
          <p>
            The desktop app is that plan made real. One install, a five minute setup, and Dex
            starts learning how you work: your day in one brief, your promises tracked, your
            follow-ups drafted before you ask. No terminal. No configuration files. No jargon.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="desktop-builder">
        <div className={styles.letterCard}>
          <Label>FROM THE BUILDER</Label>
          <div className={styles.letterBody} id="desktop-builder">
            <p>
              I have been building Dex nights and weekends for a long time, and this is the
              moment I have been working toward: putting it in the hands of people who do not
              care how it works, only that it does.
            </p>
            <p>
              You are getting the very first desktop build. Some edges are still rough, and
              honestly, that is why you are here. Every annotation you leave, every piece of
              feedback you send, lands directly with me. I read all of it, I triage all of it,
              and you will see my replies and the status of everything you raise inside the app
              itself.
            </p>
            <p>Thank you for being early. It means more than you know.</p>
            <p className={styles.signature}>Dave</p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.stepsSection}`} aria-labelledby="desktop-start">
        <div>
          <Label>GET STARTED</Label>
          <h2 id="desktop-start">Get started.</h2>
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
            There is a feedback toolbar inside the app. Click it, point at anything that
            confuses or delights you, and write what you think. Before anything is sent you see
            exactly what will be shared and you can remove whatever you want. After you send it,
            AI groups your notes with other testers&apos; reports, I review every single one, and
            real issues go on the public roadmap. When something you raised ships, the app
            tells you.
          </p>
        </div>
        <div className={styles.visualStrip}>
          {feedbackSteps.map((step) => (
            <figure key={step.label} className={styles.visualItem}>
              <div className={styles.imageFrame}>
                <img src={step.src} alt={step.alt} loading="lazy" />
              </div>
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
    </main>
  );
}
