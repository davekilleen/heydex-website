import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import './ReviewPage.css';

const VISIBILITY_OPTIONS = [
  {
    id: 'public',
    label: 'Public',
    blurb:
      'Anyone can view it on Heydex. Best for helping more people on their AI journey by sharing how you work with AI.',
  },
  {
    id: 'colleagues',
    label: 'Colleagues only',
    blurb:
      'Only people from your company can view how you work with AI.',
  },
  {
    id: 'private',
    label: 'Private first',
    blurb:
      'Only you can view it until you decide to share it more widely later.',
  },
];

function tagsToInput(tags = []) {
  return tags.join(', ');
}

function parseTags(value = '') {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function autosizeTextarea(element) {
  if (!element || element.tagName !== 'TEXTAREA') return;
  element.style.height = '0px';
  element.style.height = `${element.scrollHeight}px`;
}

function getHeroCopy(sessionKind) {
  switch (sessionKind) {
    case 'loveLetter':
      return {
        eyebrow: 'Love Letter draft',
        title: 'Share why Dex changed how you work.',
        body:
          'This is your profile with a Love Letter draft. Tighten the wording if you want, then publish it so other people understand what Dex unlocked for you.',
      };
    case 'combined':
      return {
        eyebrow: 'Draft review',
        title: 'Your diff is ready. Your Love Letter is here too.',
        body:
          'This draft already has your Love Letter attached. Tighten the workflow wording if you want, adjust the note if you want, then publish when it feels like you.',
      };
    default:
      return {
        eyebrow: 'Draft review',
        title: 'Dex drafted your Heydex profile. If it looks right, publish it.',
        body:
          'This is the page people will see on Heydex. You can change any line here, but you do not have to. Skim it, make any edits you want, then publish.',
      };
  }
}

function getPublishLabel(sessionKind, visibility) {
  if (visibility === 'private') {
    return sessionKind === 'loveLetter' ? 'Create private profile' : 'Create private profile';
  }
  if (visibility === 'colleagues') {
    return 'Share with colleagues';
  }
  if (sessionKind === 'loveLetter') {
    return 'Publish love letter publicly';
  }
  if (sessionKind === 'combined') {
    return 'Publish profile and letter publicly';
  }
  return 'Publish publicly';
}

function getPublishSummary(sessionKind, visibility, companyName) {
  if (visibility === 'private') {
    return [
      'Your profile stays private on Heydex.',
      sessionKind === 'loveLetter'
        ? 'Your Love Letter is saved to the private profile first.'
        : 'You can keep refining before anyone else sees it.',
      'You can switch it to wider visibility later.',
    ];
  }

  if (visibility === 'colleagues') {
    return [
      `Only colleagues${companyName ? ` at ${companyName}` : ''} can view it.`,
      sessionKind === 'loveLetter'
        ? 'Your Love Letter becomes part of your profile immediately.'
        : 'Your workflows go live, but only inside your company boundary.',
      'You can still widen it later.',
    ];
  }

  return [
    'Your profile goes live on Heydex.',
    sessionKind === 'loveLetter'
      ? 'The Love Letter appears with your profile header.'
      : sessionKind === 'combined'
        ? 'Your Love Letter appears above the workflow list.'
        : 'Your workflows appear in the order shown below.',
    'You can come back and edit later.',
  ];
}

function getSessionErrorContent(errorCode, error) {
  switch (errorCode) {
    case 'EXPIRED':
      return {
        title: 'This review link expired.',
        body:
          'Review links stay open for 30 minutes. Your saved draft is still on your machine, but this browser session can no longer publish it.',
        detail:
          'Return to Dex and reopen the same saved draft to mint a fresh review link.',
      };
    case 'ALREADY_PUBLISHED':
      return {
        title: 'This draft is already live.',
        body:
          'This review link has already been used to publish the profile.',
        detail:
          'Open your Heydex profile to keep editing the live version.',
      };
    case 'NOT_FOUND':
      return {
        title: 'This review link is no longer available.',
        body:
          'We could not find a matching review session for this URL.',
        detail:
          'If you still have the saved draft locally, reopen it from Dex to create a fresh review link.',
      };
    case 'USER_NOT_FOUND':
      return {
        title: 'The profile behind this draft is missing.',
        body:
          'We found the review link, but the account it belongs to is no longer available.',
        detail:
          'Sign in again or restart the draft review flow from Dex.',
      };
    default:
      return {
        title: 'Review session error',
        body: error || 'Something went wrong while loading this draft.',
        detail: '',
      };
  }
}

function normalizeMutationError(error) {
  const message = error?.message || 'Something went wrong.';

  if (message.includes('Session expired')) {
    return { errorCode: 'EXPIRED', error: 'This review link expired.' };
  }

  if (message.includes('Already published')) {
    return { errorCode: 'ALREADY_PUBLISHED', error: 'This draft is already live.' };
  }

  if (message.includes('Session not found')) {
    return { errorCode: 'NOT_FOUND', error: 'This review link is no longer available.' };
  }

  return { errorCode: 'UNKNOWN', error: message };
}

export default function ReviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionCode = searchParams.get('session');

  const sessionData = useQuery(api.review.getSession, sessionCode ? { sessionCode } : 'skip');
  const updateVisibility = useMutation(api.review.updateVisibility);
  const updateDraftDiff = useMutation(api.review.updateDraftDiff);
  const updateProfileDraft = useMutation(api.review.updateProfileDraft);
  const updateLoveLetterDraft = useMutation(api.review.updateLoveLetterDraft);
  const publishFromSession = useMutation(api.review.publishFromSession);

  const [visibility, setVisibility] = useState('private');
  const [publishing, setPublishing] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [draftDiffs, setDraftDiffs] = useState([]);
  const [loveLetterDraft, setLoveLetterDraft] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingDiffIndex, setSavingDiffIndex] = useState(null);
  const [savingLoveLetter, setSavingLoveLetter] = useState(false);
  const [actionError, setActionError] = useState('');
  const [localSessionError, setLocalSessionError] = useState(null);

  useEffect(() => {
    if (sessionData && !sessionData.error) {
      setVisibility(sessionData.visibility ?? 'private');
      setProfileDraft(sessionData.profile);
      setLoveLetterDraft(sessionData.loveLetterDraft ?? '');
      setDraftDiffs(
        (sessionData.diffs ?? []).map((diff) => ({
          ...diff,
          tagsInput: tagsToInput(diff.tags),
        }))
      );
      setActionError('');
      setLocalSessionError(null);
    }
  }, [sessionData]);

  const sessionKind = sessionData?.sessionKind ?? 'diffs';
  const hero = getHeroCopy(sessionKind);

  const profileUrl = useMemo(() => {
    if (!sessionData?.userHandle) return null;
    return `heydex.ai/diff/@${sessionData.userHandle}`;
  }, [sessionData?.userHandle]);

  const profileInitials =
    profileDraft?.displayName
      ?.split(' ')
      .map((part) => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';

  const publishSummary = getPublishSummary(
    sessionKind,
    visibility,
    profileDraft?.company
  );
  const resolvedSessionError =
    localSessionError ??
    (sessionData?.error
      ? {
          errorCode: sessionData.errorCode,
          error: sessionData.error,
        }
      : null);

  if (!sessionCode) {
    return (
      <div className="review-page review-centered">
        <h1>Invalid review link</h1>
        <p>No session code was provided.</p>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="review-page review-centered">
        <p>Loading...</p>
      </div>
    );
  }

  if (resolvedSessionError) {
    const errorContent = getSessionErrorContent(
      resolvedSessionError.errorCode,
      resolvedSessionError.error
    );

    return (
      <div className="review-page review-centered">
        <div className="review-error-panel">
          <span className="review-eyebrow">Draft review</span>
          <h1>{errorContent.title}</h1>
          <p>{errorContent.body}</p>
          {errorContent.detail ? (
            <p className="review-error-detail">{errorContent.detail}</p>
          ) : null}
          <div className="review-error-actions">
            <a href="/diff/profile/" className="review-primary-button review-inline-button">
              Go to your profile
            </a>
            <a href="/diff/" className="review-secondary-button">
              Back to DexDiff
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (sessionData.needsRegistration) {
    return (
      <div className="review-page review-shell">
        <div className="review-empty-state">
          <span className="review-eyebrow">Before you publish</span>
          <h1>Build your profile first</h1>
          <p>
            Next you&apos;ll pull in your LinkedIn details, review what Dex keeps,
            and then come straight back here to edit your draft before publishing.
          </p>
          <button
            className="review-primary-button"
            onClick={() =>
              navigate(`/connect/?return=${encodeURIComponent(`/diff/review/?session=${sessionCode}`)}`)
            }
          >
            Continue to profile setup
          </button>
        </div>
      </div>
    );
  }

  async function handleVisibilityChange(nextVisibility) {
    if (nextVisibility === visibility) return;
    const previousVisibility = visibility;
    setVisibility(nextVisibility);
    setActionError('');
    try {
      await updateVisibility({ sessionCode, visibility: nextVisibility });
    } catch (error) {
      const normalizedError = normalizeMutationError(error);
      setVisibility(previousVisibility);
      if (normalizedError.errorCode !== 'UNKNOWN') {
        setLocalSessionError(normalizedError);
      } else {
        setActionError(normalizedError.error);
      }
    }
  }

  function handleProfileFieldChange(field, value) {
    setProfileDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSaveProfile() {
    if (!profileDraft) return;
    try {
      setSavingProfile(true);
      setActionError('');
      await updateProfileDraft({
        sessionCode,
        displayName: profileDraft.displayName?.trim() || '',
        title: profileDraft.title?.trim() || '',
        company: profileDraft.company?.trim() || '',
        summary: profileDraft.summary?.trim() || '',
      });
    } catch (error) {
      const normalizedError = normalizeMutationError(error);
      if (normalizedError.errorCode !== 'UNKNOWN') {
        setLocalSessionError(normalizedError);
      } else {
        setActionError(normalizedError.error);
      }
    } finally {
      setSavingProfile(false);
    }
  }

  function handleDiffFieldChange(index, field, value) {
    setDraftDiffs((current) =>
      current.map((diff, diffIndex) =>
        diffIndex === index ? { ...diff, [field]: value } : diff
      )
    );
  }

  async function handleSaveDiff(index, overrides = {}) {
    const currentDiff = draftDiffs[index];
    const diff = currentDiff ? { ...currentDiff, ...overrides } : null;
    if (!diff) return;

    try {
      setSavingDiffIndex(index);
      setActionError('');
      await updateDraftDiff({
        sessionCode,
        index,
        name: diff.name.trim(),
        description: diff.description.trim(),
        methodology: diff.methodology?.trim() || '',
        tags: parseTags(diff.tagsInput),
      });
    } catch (error) {
      const normalizedError = normalizeMutationError(error);
      if (normalizedError.errorCode !== 'UNKNOWN') {
        setLocalSessionError(normalizedError);
      } else {
        setActionError(normalizedError.error);
      }
    } finally {
      setSavingDiffIndex(null);
    }
  }

  async function handleSaveLoveLetter() {
    try {
      setSavingLoveLetter(true);
      setActionError('');
      await updateLoveLetterDraft({
        sessionCode,
        text: loveLetterDraft.trim(),
      });
    } catch (error) {
      const normalizedError = normalizeMutationError(error);
      if (normalizedError.errorCode !== 'UNKNOWN') {
        setLocalSessionError(normalizedError);
      } else {
        setActionError(normalizedError.error);
      }
    } finally {
      setSavingLoveLetter(false);
    }
  }

  async function handlePublish() {
    try {
      setPublishing(true);
      setActionError('');
      const result = await publishFromSession({ sessionCode });
      if (visibility === 'private') {
        window.location.href = '/diff/profile/';
        return;
      }
      window.location.href = `/diff/@${result.handle}/`;
    } catch (error) {
      const normalizedError = normalizeMutationError(error);
      if (normalizedError.errorCode !== 'UNKNOWN') {
        setLocalSessionError(normalizedError);
      } else {
        setActionError(normalizedError.error);
      }
      setPublishing(false);
    }
  }

  return (
    <div className="review-page">
      <div className="review-shell">
        <section className="review-intro">
          <span className="review-eyebrow">{hero.eyebrow}</span>
          <h1>{hero.title}</h1>
          <p className="review-intro-copy">{hero.body}</p>
        </section>

        {actionError ? (
          <div className="review-status-banner review-status-banner-error">{actionError}</div>
        ) : null}

        <div className="review-main-grid">
          <div className="review-left-column">
            <section className="review-card review-profile-card">
              <div className="review-card-header">
                <div>
                  <span className="review-kicker">Profile preview</span>
                  <p className="review-subcopy">
                    This is the top of your public profile. Click any line to edit it.
                  </p>
                </div>
                <span className="review-edit-pill">{savingProfile ? 'Saving...' : 'Edit'}</span>
              </div>

              <div className="review-profile-body">
                {profileDraft?.photoUrl ? (
                  <img
                    src={profileDraft.photoUrl}
                    alt={profileDraft.displayName}
                    className="review-profile-photo"
                  />
                ) : (
                  <div className="review-profile-avatar">{profileInitials}</div>
                )}

                <div className="review-profile-fields">
                  <div className="review-name-block">
                    <input
                      className="review-inline-input review-inline-name"
                      value={profileDraft?.displayName || ''}
                      onChange={(event) => handleProfileFieldChange('displayName', event.target.value)}
                      onBlur={handleSaveProfile}
                    />
                    <div className="review-handle">@{sessionData.userHandle}</div>
                  </div>

                  <div className="review-profile-meta-row">
                    <input
                      className="review-inline-input review-inline-subtle"
                      value={profileDraft?.title || ''}
                      onChange={(event) => handleProfileFieldChange('title', event.target.value)}
                      onBlur={handleSaveProfile}
                    />
                    <span className="review-divider">/</span>
                    <input
                      className="review-inline-input review-inline-subtle"
                      value={profileDraft?.company || ''}
                      onChange={(event) => handleProfileFieldChange('company', event.target.value)}
                      onBlur={handleSaveProfile}
                    />
                    <span className="review-divider">/</span>
                    <span className="review-link-label">LinkedIn profile</span>
                  </div>

                  <textarea
                    rows={1}
                    className="review-inline-textarea review-inline-summary"
                    value={profileDraft?.summary || ''}
                    onChange={(event) => handleProfileFieldChange('summary', event.target.value)}
                    onInput={(event) => autosizeTextarea(event.currentTarget)}
                    onFocus={(event) => autosizeTextarea(event.currentTarget)}
                    onBlur={(event) => {
                      autosizeTextarea(event.currentTarget);
                      handleSaveProfile();
                    }}
                  />
                </div>
              </div>
            </section>

            {sessionKind !== 'loveLetter' && (
              <section className="review-card review-workflows-card">
                <div className="review-workflows-header">
                  <span className="review-kicker">
                    {sessionKind === 'combined' ? 'Editing workflows' : 'Workflows Dex found for you'}
                  </span>
                  <h2>
                    {sessionKind === 'combined'
                      ? 'Change the language if you want.'
                      : 'These are ready to publish as they are. Edit them only if you want the wording to feel more like you.'}
                  </h2>
                  <p className="review-subcopy">
                    {sessionKind === 'combined'
                      ? 'Titles and descriptions edit inline. The Love Letter lives alongside the workflows in the right rail.'
                      : 'You do not need to edit these before publishing, but you can if you want the wording to feel more like you.'}
                  </p>
                </div>

                <div className="review-diff-list">
                  {draftDiffs.map((diff, index) => (
                    <article key={`${diff.diffId}-${index}`} className="review-diff-item">
                      <div className="review-diff-item-header">
                        <div>
                          <div className="review-diff-number">{String(index + 1).padStart(2, '0')}</div>
                          <input
                            className="review-inline-input review-inline-workflow-name"
                            value={diff.name}
                            onChange={(event) =>
                              handleDiffFieldChange(index, 'name', event.target.value)
                            }
                            onBlur={(event) =>
                              handleSaveDiff(index, { name: event.target.value })
                            }
                          />
                        </div>
                        <span className="review-edit-pill">
                          {savingDiffIndex === index ? 'Saving...' : 'Edit'}
                        </span>
                      </div>

                      <textarea
                        rows={1}
                        className="review-inline-textarea review-inline-description"
                        value={diff.description}
                        onChange={(event) =>
                          handleDiffFieldChange(index, 'description', event.target.value)
                        }
                        onInput={(event) => autosizeTextarea(event.currentTarget)}
                        onFocus={(event) => autosizeTextarea(event.currentTarget)}
                        onBlur={(event) => {
                          autosizeTextarea(event.currentTarget);
                          handleSaveDiff(index, { description: event.target.value });
                        }}
                      />

                      <input
                        className="review-inline-input review-inline-tags"
                        value={diff.tagsInput}
                        onChange={(event) =>
                          handleDiffFieldChange(index, 'tagsInput', event.target.value)
                        }
                        onBlur={(event) =>
                          handleSaveDiff(index, { tagsInput: event.target.value })
                        }
                        placeholder="meeting prep, relationship memory"
                      />

                      {parseTags(diff.tagsInput).length > 0 && (
                        <div className="review-tag-list">
                          {parseTags(diff.tagsInput).map((tag) => (
                            <span key={`${diff.diffId}-${tag}`} className="review-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <details className="review-methodology" open={Boolean(diff.methodology)}>
                        <summary>Working method</summary>
                        <textarea
                          rows={1}
                          className="review-inline-textarea review-inline-methodology"
                          value={diff.methodology}
                          onChange={(event) =>
                            handleDiffFieldChange(index, 'methodology', event.target.value)
                          }
                          onInput={(event) => autosizeTextarea(event.currentTarget)}
                          onFocus={(event) => autosizeTextarea(event.currentTarget)}
                          onBlur={(event) => {
                            autosizeTextarea(event.currentTarget);
                            handleSaveDiff(index, { methodology: event.target.value });
                          }}
                        />
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {sessionKind === 'loveLetter' && (
              <section className="review-card review-love-letter-card review-love-letter-primary">
                <div className="review-card-header">
                  <div>
                    <span className="review-kicker">Love Letter</span>
                    <h2>Tell people what Dex changed for you.</h2>
                    <p className="review-subcopy">
                      This sits on your profile as a short personal note. Keep it warm, specific, and grounded in your real experience.
                    </p>
                  </div>
                  <span className="review-edit-pill">{savingLoveLetter ? 'Saving...' : 'Edit'}</span>
                </div>

                <textarea
                  rows={3}
                  className="review-love-letter-input"
                  value={loveLetterDraft}
                  onChange={(event) => setLoveLetterDraft(event.target.value)}
                  onInput={(event) => autosizeTextarea(event.currentTarget)}
                  onFocus={(event) => autosizeTextarea(event.currentTarget)}
                  onBlur={(event) => {
                    autosizeTextarea(event.currentTarget);
                    handleSaveLoveLetter();
                  }}
                />

                <div className="review-note-card">
                  Add a personal layer to your profile so people understand not just what you built, but why Dex mattered enough for you to talk about it publicly.
                </div>
              </section>
            )}
          </div>

          <div className="review-right-column">
            <section className="review-card review-publish-card">
              <div className="review-card-header review-card-header-column">
                <span className="review-kicker">Publish</span>
                <h2>
                  {sessionKind === 'loveLetter'
                    ? 'Publish your Love Letter.'
                    : sessionKind === 'combined'
                      ? 'Publish the full profile.'
                      : 'Looks good? Publish it.'}
                </h2>
                <p className="review-subcopy">
                  {sessionKind === 'loveLetter'
                    ? 'People will see your profile header and this note together.'
                    : sessionKind === 'combined'
                      ? 'Your workflows and your Love Letter will appear together on your profile.'
                      : 'Dex has drafted this for you. You can change any part of it, but you do not need to before publishing.'}
                </p>
              </div>

              <div className="review-publish-summary">
                <div className="review-summary-label">Selected audience</div>
                <div className="review-summary-chip">
                  {VISIBILITY_OPTIONS.find((option) => option.id === visibility)?.label}
                </div>
                <div className="review-summary-list">
                  {publishSummary.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="review-primary-button"
                onClick={handlePublish}
                disabled={publishing || (sessionKind === 'loveLetter' && !loveLetterDraft.trim())}
              >
                {publishing ? 'Publishing...' : getPublishLabel(sessionKind, visibility)}
              </button>
            </section>

            {sessionKind === 'combined' && (
              <section className="review-card review-love-letter-card">
                <div className="review-card-header">
                  <div>
                    <span className="review-kicker">Love Letter</span>
                    <h2>Already attached to this profile.</h2>
                    <p className="review-subcopy">
                      Keep it as it is, or edit the note so it sounds more like you before publishing.
                    </p>
                  </div>
                  <span className="review-edit-pill">
                    {savingLoveLetter ? 'Saving...' : 'Edit'}
                  </span>
                </div>

                <textarea
                  rows={4}
                  className="review-love-letter-input"
                  value={loveLetterDraft}
                  onChange={(event) => setLoveLetterDraft(event.target.value)}
                  onInput={(event) => autosizeTextarea(event.currentTarget)}
                  onFocus={(event) => autosizeTextarea(event.currentTarget)}
                  onBlur={(event) => {
                    autosizeTextarea(event.currentTarget);
                    handleSaveLoveLetter();
                  }}
                />

                <div className="review-note-card">
                  People do not just see what you built. They also see why you cared enough to share it.
                </div>
              </section>
            )}

            <section className="review-card review-audience-card">
              <div className="review-card-header review-card-header-column">
                <span className="review-kicker">Who can see it?</span>
                <h2>Choose how widely you want to share it.</h2>
                <p className="review-subcopy">
                  Public helps more people. Colleagues only keeps it inside your company. Private first lets you publish safely before widening it.
                </p>
              </div>

              <div className="review-audience-options">
                {VISIBILITY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`review-audience-option${
                      visibility === option.id ? ' review-audience-option-active' : ''
                    }`}
                    onClick={() => handleVisibilityChange(option.id)}
                  >
                    <div className="review-audience-title-row">
                      <span>{option.label}</span>
                      {option.id === 'public' && (
                        <span className="review-recommended-pill">Recommended</span>
                      )}
                    </div>
                    <div className="review-audience-blurb">
                      {option.id === 'colleagues' && profileDraft?.company
                        ? `${option.blurb} For you, that means colleagues working at ${profileDraft.company}.`
                        : option.blurb}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {sessionKind === 'loveLetter' && (
              <section className="review-card review-note-card review-secondary-note">
                <span className="review-kicker">What comes next</span>
                <h3>You can always add your diffs later.</h3>
                <p>
                  Publishing a Love Letter first gives you a public profile immediately.
                  When you share workflows later, they simply slot in underneath it.
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="review-footer-note">
          <span className="review-kicker">Profile URL</span>
          <div>{profileUrl}</div>
        </div>
      </div>
    </div>
  );
}
