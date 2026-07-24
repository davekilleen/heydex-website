import { useQuery } from 'convex/react';
import { useConvexAuth } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../../convex/_generated/api';
import { TEXT_TERTIARY } from '../theme';
import './DiffPage.css';

export default function DiffPage() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const betaAccess = useQuery(api.beta.viewerAccess);
  const diffs = useQuery(api.diffs.list, betaAccess?.allowed ? {} : 'skip');
  const currentUser = useQuery(
    api.users.me,
    betaAccess?.allowed ? {} : 'skip',
  );

  async function handleLogout(event) {
    event.preventDefault();
    await signOut();
    window.location.href = '/diff/';
  }

  if (isAuthenticated && betaAccess && !betaAccess.allowed) {
    return (
      <main className="content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section style={{ maxWidth: 560, padding: 32, textAlign: 'center' }}>
          <div className="hero-label">DexDiff private beta</div>
          <h1 className="hero-headline" style={{ fontSize: 44 }}>You&apos;re not in the beta yet</h1>
          <p className="hero-sub">
            DexDiff is opening in small groups. Your account is signed in, but it
            hasn&apos;t been added to this beta yet. We&apos;ll let you know when a
            place opens.
          </p>
          <button type="button" className="btn-outline" onClick={handleLogout}>
            Use a different account
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      {/* NAV */}
      <nav className="nav" aria-label="Main navigation">
        <div className="nav-inner">
          <a href="/diff/" className="nav-logo">&#9670; dexdiff</a>
          <div className="nav-links">
            <a href="/diff/community/" className="nav-link">Community</a>
            <a href="/diff/company/" className="nav-link">Your Company</a>
            <a href="/diff/love-letters/" className="nav-link">Love Letters</a>
            
            {isAuthenticated && currentUser ? (
              <div className="auth-indicator" style={{ display: 'flex' }}>
                <a href="/diff/profile/" className="auth-indicator-handle">
                  @{currentUser.handle}
                </a>
                <button type="button" onClick={handleLogout} className="auth-logout">
                  Log out
                </button>
              </div>
            ) : (
              <a href="/connect/" className="nav-cta">Get Dexed Up</a>
            )}
          </div>
        </div>
      </nav>

      <main className="content">
        {/* HERO */}
        <section className="hero">
          <div className="hero-label">Introducing DexDiff</div>
          <h1 className="hero-headline">See how others use AI.<br/>Share how you do.</h1>
          <p className="hero-sub">
            DexDiff is a community of people helping each other get more from AI. Browse real workflows from people in your role. Get inspired. Adopt what works. Share what you've built so others can learn from you.
          </p>
          <div className="hero-buttons">
            <a href="#browse-diffs" className="btn-primary">Browse Diffs</a>
            <a href="/connect/" className="btn-outline">Get Dexed Up</a>
          </div>
        </section>

        {/* LOVE LETTER CAROUSEL */}
        <section className="section">
          <h2 className="section-label">Love Letters</h2>
          <div className="section-sub">Real reactions from real people.</div>

          <div className="carousel-wrapper">
            <div className="carousel-track">
              <div className="carousel-card center">
                <div className="carousel-quote">
                  "I never walk into a meeting cold anymore. That alone changed how my team sees me."
                </div>
                <div className="carousel-author">
                  <div className="avatar">DK</div>
                  <div className="carousel-author-info">
                    <span className="carousel-author-name">Dave Killeen</span>
                    <span className="carousel-author-role">Pendo · Field CPO</span>
                    <a href="https://linkedin.com/in/davekilleen" target="_blank" rel="noopener" className="carousel-author-link">
                      LinkedIn &#8599;
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FIRST MOVERS */}
        <section className="section">
          <h2 className="section-label">First Movers</h2>
          <div className="section-sub">The first people brave enough to share how they actually work.</div>

          <div className="contributor-card">
            <div className="contributor-top">
              <div className="avatar avatar-lg">DK</div>
              <div className="contributor-info">
                <div className="contributor-name-row">
                  <span className="contributor-name">Dave Killeen</span>
                  <a href="https://linkedin.com/in/davekilleen" target="_blank" rel="noopener" className="contributor-link">
                    LinkedIn &#8599;
                  </a>
                </div>
                <div className="contributor-role">Field CPO at Pendo &middot; B2B SaaS</div>
                <div className="contributor-stat">7 Diffs</div>
                <div className="contributor-quote">
                  Every interaction compounds into the next one. After 3 months, my Dex knows more about my professional relationships than I do.
                </div>
                <div className="contributor-tags">
                  <span className="contributor-tag">Meeting Intelligence</span>
                  <span className="contributor-tag">Deal Intelligence</span>
                  <span className="contributor-tag">Weekly Rhythm</span>
                  <span className="contributor-tag more">+4 more</span>
                </div>
                <a href="/diff/dave/" className="contributor-view">View profile &rarr;</a>
              </div>
            </div>
          </div>

          <div className="ghost-card">
            <div className="ghost-text">Help others become more AI-fluent. Share how you work.</div>
            <div className="ghost-cmd">/diff-profile</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: TEXT_TERTIARY, marginTop: '8px', textAlign: 'center', lineHeight: 1.6 }}>
              Type this into your Dex. It scans your vault, finds your custom workflows, and generates a shareable profile in 30 seconds.
            </div>
          </div>
        </section>

        {/* BROWSE DIFFS */}
        <section className="section" id="browse-diffs">
          <h2 className="section-label">Browse Diffs</h2>

          <div className="tabs">
            <button className="tab active">All Diffs</button>
            <a href="/diff/company/" className="tab" style={{ textDecoration: 'none' }}>At Your Company</a>
          </div>

          <div className="filters">
            <button className="filter-btn" disabled style={{ opacity: 0.4, cursor: 'default' }} title="Coming soon">
              Role &#9662;
            </button>
            <button className="filter-btn" disabled style={{ opacity: 0.4, cursor: 'default' }} title="Coming soon">
              Seniority &#9662;
            </button>
            <button className="filter-btn active">All</button>
          </div>

          <div className="diff-grid">
            {!diffs ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                Loading diffs...
              </div>
            ) : diffs.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                No diffs found
              </div>
            ) : (
              diffs.map((diff) => (
                <div key={diff.diffId} className="browse-card">
                  <div className="browse-card-title">{diff.name}</div>
                  <div className="browse-card-author">
                    @{diff.authorHandle}
                  </div>
                  <div className="browse-card-desc">{diff.description}</div>
                  <a href={`/diff/${diff.authorHandle}/`} className="browse-card-link">
                    View &rarr;
                  </a>
                </div>
              ))
            )}
          </div>
        </section>

        {/* MORE LOVE LETTERS */}
        <section className="section">
          <h2 className="section-label">More Love Letters</h2>
          <div className="section-sub">Real reactions from real people. Not written on demand.</div>

          <div className="love-letters-stack">
            <div className="love-letter">
              <div className="ll-avatar">DK</div>
              <div>
                <div className="love-letter-quote">
                  "I never walk into a meeting cold anymore. That alone changed how my team sees me."
                </div>
                <div className="love-letter-author">
                  <span>Dave Killeen</span>
                  <span>&middot;</span>
                  <span>Field CPO at Pendo</span>
                  <span>&middot;</span>
                  <a href="https://linkedin.com/in/davekilleen" target="_blank" rel="noopener">
                    LinkedIn &#8599;
                  </a>
                </div>
              </div>
            </div>
          </div>
          <a 
            href="/diff/love-letters/" 
            style={{ 
              display: 'block', 
              fontFamily: 'var(--font-sans)', 
              fontSize: '13px', 
              color: 'var(--text-secondary)', 
              marginTop: '16px', 
              textDecoration: 'none', 
              transition: 'color 80ms ease' 
            }}
          >
            See all love letters &rarr;
          </a>
        </section>

        {/* FOOTER */}
        <footer className="footer">
          <div className="footer-logo">&#9670; Dex</div>
          <div className="footer-right">
            Your data never leaves your machine &middot; <a href="/privacy/">Privacy</a> &middot; <a href="/terms/">Terms</a>
          </div>
        </footer>
      </main>
    </>
  );
}
