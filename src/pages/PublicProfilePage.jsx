import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import './PublicProfilePage.css';

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getShareCta(hasDiffs, hasLoveLetter) {
  if (hasDiffs && hasLoveLetter) {
    return {
      title: 'Share the work, the reason behind it, or both.',
      body:
        'The strongest profiles combine practical workflows with a personal point of view, but you can start from either side.',
      button: 'Create your profile',
    };
  }

  if (hasLoveLetter) {
    return {
      title: 'You can start with a Love Letter, then add your workflows later.',
      body:
        'If you are not ready to publish your diffs yet, a Love Letter is still a real way to show how Dex changed your work.',
      button: 'Write your Love Letter',
    };
  }

  return {
    title: 'Publish your workflows, then add the reason behind them.',
    body:
      'You can start by sharing a diff. If you want it to feel more personal, add a Love Letter too.',
    button: 'Start with your diff',
  };
}

function hasSavedAuthState() {
  if (typeof window === 'undefined') {
    return false;
  }

  return Object.keys(window.localStorage).some(
    (key) =>
      key === 'auth_redirect_to' ||
      key.startsWith('__convexAuthJWT_') ||
      key.startsWith('__convexAuthRefreshToken_')
  );
}

function CommandSurface({
  label,
  command,
  copied,
  isAuthenticated,
  isAdopted = false,
  onCopy,
  returnPath,
}) {
  return (
    <div className="public-profile-command-surface">
      <div className="public-profile-command-label">{label}</div>
      <div className="public-profile-command-row">
        <code className="public-profile-command-text">{command}</code>
        {isAuthenticated ? (
          isAdopted ? (
            <span className="public-profile-command-status">Already adopted</span>
          ) : (
            <button type="button" className="public-profile-command-action" onClick={() => onCopy(command)}>
              {copied === command ? 'Copied' : 'Copy'}
            </button>
          )
        ) : (
          <a
            href={`/connect/?return=${encodeURIComponent(returnPath)}`}
            className="public-profile-command-action public-profile-command-link"
          >
            Register to copy
          </a>
        )}
      </div>
    </div>
  );
}

export default function PublicProfilePage() {
  const { handle: rawHandle = '' } = useParams();
  const handle = rawHandle.replace(/^@/, '');
  const viewerState = useQuery(api.users.viewerState);
  const savedAuthStatePresent = useMemo(() => hasSavedAuthState(), []);
  const isAuthenticated =
    viewerState?.authenticated === true || savedAuthStatePresent;
  const profile = useQuery(api.profiles.get, handle ? { handle } : 'skip');
  const adoptions = useQuery(api.adoptions.mine, isAuthenticated ? {} : 'skip');
  const loveLetters = useQuery(api.loveLetters.list, handle ? { handle, limit: 3 } : 'skip');
  const [copied, setCopied] = useState('');

  const adoptedSlugs = useMemo(
    () => new Set((adoptions || []).map((item) => item.diffSlug)),
    [adoptions],
  );

  async function copyCommand(command) {
    await navigator.clipboard.writeText(command);
    setCopied(command);
    window.setTimeout(() => setCopied(''), 1500);
  }

  if (profile === undefined) {
    return (
      <div className="public-profile-page">
        <div className="public-profile-shell">
          <div className="public-profile-loading">Loading profile...</div>
        </div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="public-profile-page">
        <div className="public-profile-shell">
          <div className="public-profile-loading">Profile not found.</div>
        </div>
      </div>
    );
  }

  const hasLoveLetter = Boolean(loveLetters && loveLetters.length > 0);
  const hasDiffs = profile.diffs.length > 0;
  const shareCta = getShareCta(hasDiffs, hasLoveLetter);
  const profileCommand = `/diff-adopt-profile @${profile.handle}`;
  const primaryLoveLetter = hasLoveLetter ? loveLetters[0] : null;
  const returnPath = window.location.pathname;

  return (
    <div className="public-profile-page">
      <nav className="public-profile-nav">
        <div className="public-profile-nav-inner">
          <a href="/diff/" className="public-profile-logo">
            Heydex
          </a>
          <div className="public-profile-nav-links">
            <a href="/diff/" className="public-profile-link">
              Browse
            </a>
            <a href="/connect/" className="public-profile-cta">
              Get Dex
            </a>
          </div>
        </div>
      </nav>

      <main className="public-profile-shell">
        <header className="public-profile-hero">
          <div className="public-profile-hero-card">
            <div className="public-profile-identity">
              {profile.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt={profile.displayName}
                  className="public-profile-photo"
                />
              ) : (
                <div className="public-profile-avatar">{initials(profile.displayName)}</div>
              )}
              <div className="public-profile-copy">
                <div className="public-profile-meta">@{profile.handle}</div>
                <h1>{profile.displayName}</h1>
                <p className="public-profile-role">
                  {[profile.role || profile.title, profile.company].filter(Boolean).join(' / ')}
                </p>
                {profile.summary && (
                  <p className="public-profile-summary">{profile.summary}</p>
                )}
                {profile.linkedinUrl && (
                  <a
                    href={profile.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="public-profile-linkedin"
                  >
                    LinkedIn
                  </a>
                )}
              </div>
            </div>

            <aside className="public-profile-sidecard">
              <div className="public-profile-label">Profile</div>
              <strong>
                {hasDiffs && hasLoveLetter
                  ? 'Love Letter + workflows'
                  : hasLoveLetter
                    ? 'Love Letter only'
                    : `${profile.diffs.length} published workflow${profile.diffs.length === 1 ? '' : 's'}`}
              </strong>
              <p>
                {hasDiffs && hasLoveLetter
                  ? 'The human note sits above the practical playbook.'
                  : hasLoveLetter
                    ? 'No workflows yet. The personal note leads.'
                    : 'No Love Letter yet. The work is visible first.'}
              </p>
              <div className="public-profile-side-note">
                {profile.totalAdoptions} total adoptions
              </div>
            </aside>
          </div>

          <div className="public-profile-adopt-card">
            <div className="public-profile-label">Clone into Dex</div>
            <h2>Pull the whole profile down in one command.</h2>
            <p className="public-profile-adopt-copy">
              The profile command brings in the full published bundle. If you only want one workflow,
              use the command on that card instead.
            </p>
            <CommandSurface
              label="Whole profile"
              command={profileCommand}
              copied={copied}
              isAuthenticated={isAuthenticated}
              onCopy={copyCommand}
              returnPath={returnPath}
            />
          </div>
        </header>

        {primaryLoveLetter && (
          <section className="public-profile-section public-profile-love-letter">
            <div className="public-profile-label">Love Letter</div>
            <blockquote className="public-profile-quote-feature">
              “{primaryLoveLetter.text}”
            </blockquote>
            <p className="public-profile-section-note">
              A personal explanation of why this profile exists, sitting directly above the workflows themselves.
            </p>
          </section>
        )}

        {hasDiffs && (
          <section className="public-profile-section">
            <div className="public-profile-label">Workflows</div>
            <div className="public-profile-diffs">
              {profile.diffs.map((diff) => {
                const command = `/diff-adopt @${profile.handle}/${diff.diffId}`;
                const adopted = adoptedSlugs.has(diff.diffId);

                return (
                  <article key={diff.diffId} className="public-profile-diff-card">
                    <div className="public-profile-diff-top">
                      <h2>{diff.name}</h2>
                      <span>{diff.adoptionCount} adopted</span>
                    </div>
                    <p>{diff.description}</p>
                    {diff.tags?.length > 0 && (
                      <div className="public-profile-tags">
                        {diff.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                    <CommandSurface
                      label="One workflow"
                      command={command}
                      copied={copied}
                      isAuthenticated={isAuthenticated}
                      isAdopted={adopted}
                      onCopy={copyCommand}
                      returnPath={returnPath}
                    />
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="public-profile-section public-profile-cta-section">
          <div>
            <div className="public-profile-label">Share your own</div>
            <h2>{shareCta.title}</h2>
            <p>{shareCta.body}</p>
          </div>
          <a href="/connect/" className="public-profile-cta-big">
            {shareCta.button}
          </a>
        </section>
      </main>
    </div>
  );
}
