import { useMemo, useState } from 'react';
import './HadexExplorationPage.css';

const concepts = [
  {
    id: 'approved-spine',
    label: 'Approved Messaging V2',
    eyebrow: 'Free forever / local-first / model-agnostic',
    headline: 'Become AI fluent by doing.',
    subhead:
      'Dex helps you work better with AI, understand how it works, and make it your own. This version carries the approved messaging spine all the way from individual fluency to Dex for Teams.',
    why: [
      'Best expression of the approved messaging stack.',
      'Clearest connection between individual growth, diffs, and organizational spread.',
      'Strongest bridge into Dex for Teams without sounding like generic enterprise software.',
    ],
    proofTitle: 'Why it works',
    proofBody:
      'The page starts with productivity, moves into ownership, then education, then diffs, then visible company spread, then the team operating layer.',
    diffTitle: 'How diffs fit',
    diffBody:
      'Diffs are framed as the identity and the transmission mechanism: make Dex your own, share what changed, and let other people build on it.',
    piTitle: 'Dex for Teams role',
    piBody:
      'Dex for Teams becomes the operating layer for AI adoption inside the company, helping organizations see how AI is actually being used, supported, and adopted at the level of real work.',
    callout: 'Best candidate to turn into the actual homepage next.',
    theme: 'approved',
  },
  {
    id: 'credibility',
    label: 'Open Source Credibility',
    eyebrow: 'Free forever / open source / local-first',
    headline: 'Open the repo. Own the system. Bring the team later.',
    subhead:
      'This direction leads with trust. The repository is public, the individual offer is free, and the premium story only appears after the foundation feels real.',
    why: [
      'Best at making the free and open-source story instantly believable.',
      'Creates the cleanest trust-to-Dex Pi ladder.',
      'Feels credible and different from generic AI product marketing.',
    ],
    proofTitle: 'Why it works',
    proofBody:
      'GitHub is the first click. Local-first ownership is explicit. The install promise feels calm and honest instead of pushy.',
    diffTitle: 'How diffs fit',
    diffBody:
      'Diffs become the social proof layer: a concrete before-and-after story that helps peers see value before they hear a pitch.',
    piTitle: 'Dex Pi role',
    piBody:
      'Dex Pi reads as the advanced harness for serious operators, not as a paywall blocking the main product.',
    callout: 'Best default direction for the main public landing page.',
    theme: 'credibility',
  },
  {
    id: 'network',
    label: 'Role-to-Role Diff Network',
    eyebrow: 'Role-to-role learning network',
    headline: 'See how people like you are getting unfair advantage with AI.',
    subhead:
      'This direction makes shared diffs the hero. The site feels like a role-based learning graph rather than another AI landing page or content hub.',
    why: [
      'Strongest expression of the diff thesis.',
      'Makes team spread feel natural instead of sold.',
      'Gives Hadex its own category language.',
    ],
    proofTitle: 'Why it works',
    proofBody:
      'The network framing turns workflows into something portable. A PM learns from a PM. A sales leader learns from a sales leader.',
    diffTitle: 'How diffs fit',
    diffBody:
      'Diffs are the core product story, not a side section. They are how private leverage becomes visible and contagious.',
    piTitle: 'Dex Pi role',
    piBody:
      'Dex Pi becomes the premium multiplier once people already understand the value of the shared workflow layer.',
    callout: 'Best direction for making Hadex feel unique and spreadable.',
    theme: 'network',
  },
  {
    id: 'os',
    label: 'Operating System Interface',
    eyebrow: 'Live personal operating system',
    headline: 'The operating layer between you and the chaos.',
    subhead:
      'This direction shows Dex as a working system: briefings, people context, commitments, and day-shaping intelligence. It is the most product-legible option.',
    why: [
      'Best at proving Dex is more than a chat box.',
      'Feels product-led without becoming fake-dashboard sludge.',
      'Makes Dex Pi feel like a deeper operating layer.',
    ],
    proofTitle: 'Why it works',
    proofBody:
      'It visualizes how Dex changes the day: better prep, cleaner follow-through, and less cognitive load carried manually.',
    diffTitle: 'How diffs fit',
    diffBody:
      'Diffs become the proof that these operating-system gains translate into real role-specific improvements.',
    piTitle: 'Dex Pi role',
    piBody:
      'Dex Pi reads as the more powerful orchestration layer for people who want the deepest version of the system.',
    callout: 'Best direction for a future product-led landing or launch page.',
    theme: 'os',
  },
];

function ConceptSection({ concept }) {
  const chips = useMemo(
    () => ({
      approved: [
        'Become AI fluent',
        'Not rented intelligence',
        'Dex has diffs',
        'Visible spread',
      ],
      credibility: ['GitHub first', 'Local-first', 'Install in 10 mins'],
      network: ['Field CPO', 'Product', 'Sales', 'Founder', 'RevOps'],
      os: ['Today in Dex', 'People context', 'Commitments', 'Diff adoption'],
    }),
    []
  );

  return (
    <section className={`hadex-concept hadex-concept--${concept.theme}`}>
      <div className="hadex-hero">
        <div className="hadex-hero-copy">
          <div className="hadex-eyebrow">{concept.eyebrow}</div>
          <h1>{concept.headline}</h1>
          <p>{concept.subhead}</p>
          <div className="hadex-actions">
            <button type="button" className="hadex-btn hadex-btn--primary">
              Get started free
            </button>
            <button type="button" className="hadex-btn hadex-btn--ghost">
              See the diff story
            </button>
          </div>
        </div>

        <aside className="hadex-sidecard">
          <div className="hadex-sidecard-label">Concept signal</div>
          <div className="hadex-chip-grid">
            {chips[concept.theme].map((chip) => (
              <span key={chip} className="hadex-chip">
                {chip}
              </span>
            ))}
          </div>
          <p>{concept.callout}</p>
        </aside>
      </div>

      <div className="hadex-grid">
        <article className="hadex-panel hadex-panel--wide">
          <div className="hadex-panel-label">{concept.proofTitle}</div>
          <h2>{concept.why[0]}</h2>
          <p>{concept.proofBody}</p>
          <ul className="hadex-list">
            {concept.why.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="hadex-panel hadex-panel--pi">
          <div className="hadex-panel-label">{concept.piTitle}</div>
          <h2>{concept.theme === 'network' ? 'Premium multiplier' : 'Advanced layer'}</h2>
          <p>{concept.piBody}</p>
          <button type="button" className="hadex-btn hadex-btn--secondary">
            Request Dex Pi access
          </button>
        </article>
      </div>

      <div className="hadex-grid">
        <article className="hadex-panel hadex-panel--wide">
          <div className="hadex-panel-label">{concept.diffTitle}</div>
          <h2>Diffs are the bridge from personal gain to team pull.</h2>
          <p>{concept.diffBody}</p>
          <div className="hadex-before-after">
            <div className="hadex-state hadex-state--before">
              <span>Before</span>
              <strong>AI value is vague and hard to share.</strong>
            </div>
            <div className="hadex-state hadex-state--after">
              <span>After</span>
              <strong>People can see what changed in work like theirs.</strong>
            </div>
          </div>
        </article>

        <article className="hadex-panel hadex-panel--profile">
          <div className="hadex-panel-label">Public profile</div>
          <h2>@dave</h2>
          <p>Meeting intelligence, deal context, morning briefings, content workflows.</p>
          <div className="hadex-mini-list">
            <span>Morning briefing</span>
            <span>Deal context</span>
            <span>Podcast to post</span>
          </div>
        </article>
      </div>
    </section>
  );
}

export default function HadexExplorationPage() {
  const [activeId, setActiveId] = useState(concepts[0].id);
  const activeConcept = concepts.find((concept) => concept.id === activeId) ?? concepts[0];

  return (
    <main className="hadex-page">
      <header className="hadex-header">
        <div>
          <div className="hadex-header-label">Hadex exploration</div>
          <h1>Three finalists from the Paper round</h1>
          <p>
            Compare the strongest directions side by side: the trust-led landing, the
            diff-network story, and the product-led operating-system version.
          </p>
        </div>
      </header>

      <nav className="hadex-tabs" aria-label="Concept selector">
        {concepts.map((concept) => (
          <button
            key={concept.id}
            type="button"
            className={concept.id === activeId ? 'hadex-tab is-active' : 'hadex-tab'}
            onClick={() => setActiveId(concept.id)}
          >
            {concept.label}
          </button>
        ))}
      </nav>

      <ConceptSection concept={activeConcept} />
    </main>
  );
}
