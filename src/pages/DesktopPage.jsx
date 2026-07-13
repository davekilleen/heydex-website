import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '../../convex/_generated/api';
import chainThreadShot from '../../shots/chain-thread.png';
import draftDetailShot from '../../shots/draft-detail.png';
import recordLiveShot from '../../shots/record-live.png';
import weeklyReviewShot from '../../shots/weekly-review.png';
import styles from './DesktopPage.module.css';

const DOWNLOAD_HREF = '/desktop/downloads/Dex-arm64.dmg';
const HELP_HOME_HREF = '/desktop/help/';
const RELEASE_NOTES_HREF = '/desktop/help/releases.html';
const FEEDBACK_HREF = '/desktop/help/giving-feedback.html';

// TODO(desktop-feedback): Swap these product-flow screenshots for real feedback-toolbar captures
// when they are committed to this repo. The former /desktop/help/screenshots/feedback-*.png files
// are absent in this checkout, so these bundled stills keep the walkthrough self-contained today.
const feedbackSteps = [
  {
    step: 'Capture',
    title: 'Capture the moment',
    description: 'Keep the useful part of a conversation while it is still fresh.',
    src: recordLiveShot,
    alt: 'Dex recording a live meeting transcript',
  },
  {
    step: 'Trace',
    title: 'Follow the thread',
    description: 'See the people, decisions, and follow-up that came from it.',
    src: chainThreadShot,
    alt: 'Dex tracing a meeting through its follow-up, people, and evidence',
  },
  {
    step: 'Review',
    title: 'Review the next move',
    description: 'Check the context behind a draft before you decide what happens next.',
    src: draftDetailShot,
    alt: 'Dex showing a follow-up draft with its supporting context',
  },
  {
    step: 'Close',
    title: 'Close with evidence',
    description: 'Come back to the work with a record of what actually moved.',
    src: weeklyReviewShot,
    alt: 'Dex weekly review showing the work completed and what carries forward',
  },
];

const feedbackLoopSteps = [
  {
    title: 'Flag it',
    description: 'Use the feedback toolbar whenever something needs a closer look.',
    position: 'loopStepOne',
  },
  {
    title: 'Review it',
    description: 'See the text and context before anything is shared.',
    position: 'loopStepTwo',
  },
  {
    title: 'See it move',
    description: 'Reports are grouped and triaged into work that needs attention.',
    position: 'loopStepThree',
  },
  {
    title: 'See the result',
    description: 'Dex tells you when an issue you raised has shipped.',
    position: 'loopStepFour',
  },
];

const gettingStartedSteps = [
  'Download the DMG, open it, and drag Dex into your Applications folder.',
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

  return (
    <main className={styles.page}>
      <Constellation />

      <div className={styles.pageLayout}>
        <aside className={styles.helpRail}>
          <div className={styles.helpRailIntro}>
            <span className={styles.helpRailLabel}>Need a hand?</span>
            <a className={styles.helpRailLink} href={HELP_HOME_HREF}>
              <span>Open the help center</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
          <nav className={styles.railNav} aria-label="Desktop help and page navigation">
            <a href="#desktop-start">Install Dex</a>
            <a href="#desktop-feedback">Feedback loop</a>
            <a href="#desktop-walkthrough">Walkthrough</a>
            <a href={FEEDBACK_HREF}>Feedback guide</a>
            <a href={RELEASE_NOTES_HREF}>Release notes</a>
          </nav>
        </aside>

        <div className={styles.pageContent}>
          <section className={`${styles.section} ${styles.hero}`} aria-labelledby="desktop-title">
            <div className={styles.heroCopy}>
              <Label>PRIVATE BETA</Label>
              <h1 id="desktop-title">Dex, out of the terminal.</h1>
              <p>{heroSubcopy}</p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href={DOWNLOAD_HREF}>
                  <span>Download for Mac</span>
                  <span className={styles.buttonMeta}>Beta · Apple Silicon</span>
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

          <section
            id="desktop-start"
            className={`${styles.section} ${styles.stepsSection}`}
            aria-labelledby="desktop-start-title"
          >
            <div>
              <Label>GET STARTED</Label>
              <h2 id="desktop-start-title">Four steps and you&apos;re running.</h2>
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
            </div>
          </section>

          <section
            id="desktop-feedback"
            className={`${styles.section} ${styles.feedbackSection}`}
            aria-labelledby="desktop-feedback-title"
          >
            <div className={styles.feedbackIntro}>
              <Label>THE FEEDBACK LOOP</Label>
              <h2 id="desktop-feedback-title">Annotate anything. Watch it become a fix.</h2>
              <p>
                There is a feedback toolbar inside the app. Point at anything that confuses or delights
                you and write what you think. Before anything is sent you see exactly what will be
                shared, and you can remove whatever you want. After you send it, AI groups your notes
                with other testers&apos; reports, I review every one, and real issues go on the roadmap.
                When something you raised ships, the app tells you.
              </p>
            </div>

            <div className={styles.loopDiagram}>
              <p className={styles.loopCenter}>It comes back to you.</p>
              <ol className={styles.loopList} aria-label="Feedback loop">
                {feedbackLoopSteps.map((step) => (
                  <li key={step.title} className={`${styles.loopStep} ${styles[step.position]}`}>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section
            id="desktop-walkthrough"
            className={`${styles.section} ${styles.walkthroughSection}`}
            aria-labelledby="desktop-walkthrough-title"
          >
            <div className={styles.walkthroughIntro}>
              <Label>IN THE APP</Label>
              <h2 id="desktop-walkthrough-title">One clear path from a live moment to the next move.</h2>
            </div>
            <ol className={styles.walkthrough} aria-label="Desktop feedback walkthrough">
              {feedbackSteps.map((step) => (
                <li key={step.title} className={styles.walkthroughItem}>
                  <div className={styles.walkthroughMeta}>
                    <span>{step.step}</span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                  <figure className={styles.walkthroughFigure}>
                    <div className={styles.walkthroughImageFrame}>
                      <img src={step.src} alt={step.alt} loading="lazy" />
                    </div>
                  </figure>
                </li>
              ))}
            </ol>
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
        </div>
      </div>
    </main>
  );
}
