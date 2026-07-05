import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import './CompanyPage.css';

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sortedEntries(record = {}) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function getCompanyName(company) {
  return company?.displayName || company?.domain || 'your company';
}

export default function CompanyPage() {
  const currentUser = useQuery(api.users.me);
  const company = useQuery(api.companies.myCompany);

  if (currentUser === undefined || company === undefined) {
    return (
      <div className="company-page">
        <div className="company-shell">
          <div className="company-loading">Loading company view...</div>
        </div>
      </div>
    );
  }

  const companyName = getCompanyName(company);
  const visibleMembers = company?.colleagues ?? [];
  const visibleMemberCount = visibleMembers.length;
  const hasCompany = Boolean(company);
  const showTeamDetail = hasCompany && visibleMemberCount >= 2;
  const integrationEntries = sortedEntries(company?.integrations);
  const functionEntries = sortedEntries(company?.functionBreakdown);

  return (
    <div className="company-page">
      <nav className="company-nav">
        <div className="company-nav-inner">
          <a href="/diff/" className="company-logo">Heydex</a>
          <div className="company-nav-links">
            <a href="/diff/" className="company-nav-link">Browse</a>
            <a href="/diff/profile/" className="company-nav-link">Your profile</a>
          </div>
        </div>
      </nav>

      <main className="company-shell">
        {!hasCompany ? (
          <section className="company-empty">
            <span className="company-label">Company view</span>
            <h1>No company workspace yet.</h1>
            <p>
              Sign in with a work email to join a company view. Personal email accounts stay
              private and do not expose colleague rosters, workflows, or integration data.
            </p>
            <a href="/connect/" className="company-primary-link">Use a work email</a>
          </section>
        ) : (
          <>
            <header className="company-hero">
              <div className="company-hero-copy">
                <span className="company-label">Diffs at your company</span>
                <h1>How {companyName} uses Dex</h1>
                <p>
                  Workflows people have chosen to share with colleagues. Private members are
                  counted only as part of the company total and do not appear anywhere else.
                </p>
              </div>
              <aside className="company-stat-panel">
                <div>
                  <span className="company-label">Members</span>
                  <strong>{company.memberCount}</strong>
                  <p>{formatCount(visibleMemberCount, 'visible profile')}</p>
                </div>
                <div>
                  <span className="company-label">Workflows</span>
                  <strong>{company.diffs.length}</strong>
                  <p>{formatCount(company.diffs.length, 'published workflow')}</p>
                </div>
              </aside>
            </header>

            <section className="company-section">
              <div className="company-section-header">
                <span className="company-label">People</span>
                <h2>{formatCount(visibleMemberCount, 'visible member')}</h2>
              </div>
              {visibleMemberCount === 0 ? (
                <div className="company-note-panel">
                  Nobody at {companyName} has opted into the company view yet.
                </div>
              ) : (
                <div className="company-roster-grid">
                  {visibleMembers.map((member) => (
                    <article key={member.handle} className="company-roster-card">
                      <div className="company-roster-avatar">
                        {(member.displayName || member.handle || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3>{member.displayName || `@${member.handle}`}</h3>
                        <p>{[member.role, member.function_].filter(Boolean).join(' / ')}</p>
                        {member.handle ? (
                          <a href={`/diff/${member.handle}/`}>View {member.displayName || member.handle}</a>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {visibleMemberCount <= 1 ? (
              <section className="company-section company-invite-state">
                <span className="company-label">Invite colleagues</span>
                <h2>Company learning starts when more people opt in.</h2>
                <p>
                  Share your profile with a teammate when it feels useful. The company page only
                  grows from people who deliberately choose colleagues or public visibility.
                </p>
                <a href="/diff/profile/" className="company-secondary-link">Review your visibility</a>
              </section>
            ) : null}

            {showTeamDetail ? (
              <>
                <section className="company-section">
                  <div className="company-section-header">
                    <span className="company-label">Published workflows</span>
                    <h2>What people have shared</h2>
                  </div>
                  {company.diffs.length === 0 ? (
                    <div className="company-note-panel">
                      Visible members have not published workflows yet.
                    </div>
                  ) : (
                    <div className="company-workflow-list">
                      {company.diffs.map((diff) => (
                        <article
                          key={`${diff.authorHandle}-${diff.diffId}`}
                          className="company-workflow-card"
                        >
                          <div className="company-workflow-top">
                            <div>
                              <h3>{diff.name}</h3>
                              <p className="company-workflow-author">
                                {diff.authorName || `@${diff.authorHandle}`}
                              </p>
                            </div>
                            <span>{formatCount(diff.adoptionCount || 0, 'adoption')}</span>
                          </div>
                          <p>{diff.description}</p>
                          <a href={`/diff/${diff.authorHandle}/`}>
                            View {diff.authorName || diff.authorHandle} workflow
                          </a>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="company-detail-grid">
                  <div className="company-section">
                    <div className="company-section-header">
                      <span className="company-label">Integrations</span>
                      <h2>Connected tools</h2>
                    </div>
                    <div className="company-integration-grid">
                      {integrationEntries.map(([integration, names]) => (
                        <article key={integration} className="company-mini-card">
                          <h3>{integration}</h3>
                          <p>{formatCount(names.length, 'person', 'people')}</p>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="company-section">
                    <div className="company-section-header">
                      <span className="company-label">Functions</span>
                      <h2>Where sharing is happening</h2>
                    </div>
                    <div className="company-function-list">
                      {functionEntries.map(([functionName, count]) => (
                        <div key={functionName} className="company-function-row">
                          <span>{functionName}</span>
                          <strong>{count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            <section className="company-teams-teaser">
              <span className="company-label">For teams and leadership</span>
              <h2>Understand how Dex is used across your organisation.</h2>
              <p>
                Which tools are connected. What jobs people are solving. Pre-configured
                integrations and packages your team can share. Org-wide context that makes every
                Dex instance smarter.
              </p>
              <a href="/connect/" className="company-secondary-link">Learn about Dex for Teams</a>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
