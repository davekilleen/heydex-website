import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import './MyProfilePage.css';

const VISIBILITY_OPTIONS = [
  {
    id: 'public',
    label: 'Public',
    blurb: 'Anyone can view your profile on Heydex.',
  },
  {
    id: 'colleagues',
    label: 'Colleagues only',
    blurb: 'Only people from your company can view it.',
  },
  {
    id: 'private',
    label: 'Private first',
    blurb: 'Only you can view it for now.',
  },
];

export default function MyProfilePage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.me);
  const myDiffs = useQuery(
    api.diffs.listByAuthor,
    currentUser?.handle ? { authorHandle: currentUser.handle } : 'skip',
  );
  const myLoveLetter = useQuery(api.loveLetters.mine);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const setVisibility = useMutation(api.users.setVisibility);
  const createLoveLetterSession = useMutation(api.review.createLoveLetterSession);

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmHandle, setDeleteConfirmHandle] = useState('');
  const [editData, setEditData] = useState({});
  const [startingLoveLetterReview, setStartingLoveLetterReview] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState('');
  const profileInitials = useMemo(
    () =>
      currentUser?.displayName
        ?.split(' ')
        .map((part) => part[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase() || '?',
    [currentUser?.displayName]
  );

  // Redirect if not authenticated
  if (!isLoading && !isAuthenticated) {
    window.location.href = '/connect/?return=' + encodeURIComponent(window.location.pathname);
    return null;
  }

  if (isLoading || !currentUser) {
    return (
      <div className="profile-loading">
        <div className="spinner" />
      </div>
    );
  }

  const userDiffs = myDiffs || [];
  const isEmpty = userDiffs.length === 0;
  const visibility = currentUser.visibility ?? (currentUser.isPublic ? 'public' : 'private');
  const publicProfileUrl = `/diff/@${currentUser.handle}/`;
  const profileCommand = `/diff-adopt-profile @${currentUser.handle}`;
  const publicProfileLabel =
    visibility === 'public'
      ? `Live at heydex.ai${publicProfileUrl}`
      : visibility === 'colleagues'
        ? `Visible only to colleagues at ${currentUser.company || 'your company'}`
        : 'Only you can see this right now';

  async function handleSaveProfile() {
    await updateProfile(editData);
    setIsEditing(false);
  }

  async function handleDeleteAccount() {
    if (deleteConfirmHandle === currentUser.handle) {
      await deleteAccount();
      window.location.href = '/';
    }
  }

  async function handleVisibilityChange(nextVisibility) {
    if (nextVisibility === visibility) return;
    await setVisibility({ visibility: nextVisibility });
  }

  async function handleLoveLetterReview() {
    try {
      setStartingLoveLetterReview(true);
      const result = await createLoveLetterSession({
        initialText: myLoveLetter?.text || undefined,
      });
      navigate(`/diff/review/?session=${result.sessionCode}`);
    } finally {
      setStartingLoveLetterReview(false);
    }
  }

  async function handleLogout(event) {
    event.preventDefault();
    await signOut();
    window.location.href = '/diff/';
  }

  function startEditing() {
    setEditData({
      displayName: currentUser.displayName,
      title: currentUser.title || currentUser.role || '',
      company: currentUser.company || '',
      summary: currentUser.summary || '',
    });
    setIsEditing(true);
  }

  async function copyCommand(command) {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    window.setTimeout(() => setCopiedCommand(''), 1500);
  }

  return (
    <div className="my-profile-page">
      <nav className="profile-nav">
        <div className="nav-content">
          <a href="/diff/" className="nav-logo">HEYDEX.AI</a>
          <div className="nav-right">
            <span className="nav-handle">@{currentUser.handle}</span>
            <button type="button" onClick={handleLogout} className="nav-logout">Log out</button>
          </div>
        </div>
      </nav>

      <div className="profile-container">
        <section className="profile-hero">
          <div className="profile-hero-copy">
            <span className="profile-eyebrow">Your profile</span>
            <h1>
              {userDiffs.length > 0
                ? 'Your diffs are live. Add a Love Letter to complete the profile.'
                : myLoveLetter
                  ? 'Your Love Letter is live. Add workflows when you are ready.'
                  : 'Shape how your Heydex profile feels.'}
            </h1>
            <p>
              {userDiffs.length > 0
                ? 'People can already see what you shared. A Love Letter adds the human reason behind it and makes the profile feel more personal.'
                : myLoveLetter
                  ? 'You already have the human note. When you publish workflows later, they will slot in underneath it.'
                  : 'This is the hosted version of your profile. Keep it private, share it with colleagues, or publish it more widely when it feels right.'}
            </p>
          </div>
          <div className="profile-status-card">
            <span className="profile-kicker">Visibility</span>
            <strong>{VISIBILITY_OPTIONS.find((option) => option.id === visibility)?.label}</strong>
            <p>{publicProfileLabel}</p>
            {visibility !== 'private' && (
              <a href={publicProfileUrl} className="profile-link-pill">
                View profile
              </a>
            )}
          </div>
        </section>

        <div className="profile-main-grid">
          <div className="profile-main-column">
            <section className="profile-card">
              <div className="profile-card-header">
                <div>
                  <span className="profile-kicker">Profile header</span>
                  <p className="profile-card-copy">
                    This is the top of your profile on Heydex.
                  </p>
                </div>
                {!isEditing && (
                  <button onClick={startEditing} className="profile-pill-button">Edit</button>
                )}
              </div>

              {isEditing ? (
                <div className="profile-edit-grid">
                  <label className="profile-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={editData.displayName}
                      onChange={(event) =>
                        setEditData({ ...editData, displayName: event.target.value })
                      }
                    />
                  </label>
                  <label className="profile-field">
                    <span>Title</span>
                    <input
                      type="text"
                      value={editData.title}
                      onChange={(event) =>
                        setEditData({ ...editData, title: event.target.value })
                      }
                    />
                  </label>
                  <label className="profile-field">
                    <span>Company</span>
                    <input
                      type="text"
                      value={editData.company}
                      onChange={(event) =>
                        setEditData({ ...editData, company: event.target.value })
                      }
                    />
                  </label>
                  <label className="profile-field profile-field-full">
                    <span>Summary</span>
                    <textarea
                      rows={4}
                      value={editData.summary}
                      onChange={(event) =>
                        setEditData({ ...editData, summary: event.target.value })
                      }
                    />
                  </label>
                  <div className="profile-actions-row">
                    <button onClick={handleSaveProfile} className="profile-primary-button">
                      Save
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="profile-secondary-button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-header-block">
                  {currentUser.photoUrl || currentUser.image ? (
                    <img
                      src={currentUser.photoUrl || currentUser.image}
                      alt={currentUser.displayName}
                      className="profile-photo"
                    />
                  ) : (
                    <div className="profile-avatar">{profileInitials}</div>
                  )}
                  <div className="profile-identity-copy">
                    <div className="profile-handle">@{currentUser.handle}</div>
                    <h2>{currentUser.displayName}</h2>
                    <p className="profile-role-line">
                      {[currentUser.title || currentUser.role, currentUser.company]
                        .filter(Boolean)
                        .join(' / ')}
                    </p>
                    {currentUser.summary && (
                      <p className="profile-summary">{currentUser.summary}</p>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="profile-card">
              <div className="profile-card-header profile-card-header-column">
                <span className="profile-kicker">Workflows</span>
                <h3>{isEmpty ? 'No workflows yet.' : 'Published workflows'}</h3>
                <p className="profile-card-copy">
                  {isEmpty
                    ? 'When you publish a diff from Dex, it will appear here.'
                    : 'These are the workflows people can already discover from your profile.'}
                </p>
              </div>

              {isEmpty ? (
                <div className="profile-note-panel">
                  Share your first workflow from Dex, then come back here to decide whether you want to add a Love Letter too.
                </div>
              ) : (
                <div className="profile-diff-list">
                  {userDiffs.map((diff) => (
                    <article key={diff._id} className="profile-diff-card">
                      <div className="profile-diff-top">
                        <h4>{diff.name || diff.title}</h4>
                        <span>{diff.adoptionCount || 0} adoptions</span>
                      </div>
                      <p>{diff.description}</p>
                      <div className="profile-command-block">
                        <div className="profile-command-kicker">One workflow</div>
                        <div className="profile-command-row">
                          <code>{`/diff-adopt @${currentUser.handle}/${diff.diffId}`}</code>
                          <button
                            type="button"
                            className="profile-pill-button"
                            onClick={() => copyCommand(`/diff-adopt @${currentUser.handle}/${diff.diffId}`)}
                          >
                            {copiedCommand === `/diff-adopt @${currentUser.handle}/${diff.diffId}`
                              ? 'Copied'
                              : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {myLoveLetter && (
              <section className="profile-card profile-love-letter-card">
                <div className="profile-card-header">
                  <div>
                    <span className="profile-kicker">Love Letter</span>
                    <h3>Your Love Letter is part of the profile.</h3>
                  </div>
                  <button
                    type="button"
                    className="profile-pill-button"
                    onClick={handleLoveLetterReview}
                    disabled={startingLoveLetterReview}
                  >
                    {startingLoveLetterReview ? 'Opening...' : 'Edit'}
                  </button>
                </div>
                <blockquote>{myLoveLetter.text}</blockquote>
              </section>
            )}
          </div>

          <div className="profile-side-column">
            <section className="profile-card">
              <div className="profile-card-header profile-card-header-column">
                <span className="profile-kicker">Clone command</span>
                <h3>Show the profile-level command exactly as others see it.</h3>
                <p className="profile-card-copy">
                  One command pulls the full published profile bundle into Dex. Individual workflow
                  commands stay on each workflow card.
                </p>
              </div>
              <div className="profile-command-block">
                <div className="profile-command-kicker">Whole profile</div>
                <div className="profile-command-row">
                  <code>{profileCommand}</code>
                  <button
                    type="button"
                    className="profile-pill-button"
                    onClick={() => copyCommand(profileCommand)}
                  >
                    {copiedCommand === profileCommand ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </section>

            <section className="profile-card">
              <div className="profile-card-header profile-card-header-column">
                <span className="profile-kicker">Who can see it?</span>
                <h3>Choose how widely you want to share it.</h3>
              </div>
              <div className="profile-visibility-options">
                {VISIBILITY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`profile-visibility-option${
                      visibility === option.id ? ' profile-visibility-option-active' : ''
                    }`}
                    onClick={() => handleVisibilityChange(option.id)}
                  >
                    <div className="profile-visibility-title">
                      <span>{option.label}</span>
                      {option.id === 'public' && <em>Recommended</em>}
                    </div>
                    <div>
                      {option.id === 'colleagues' && currentUser.company
                        ? `${option.blurb} For you, that means colleagues working at ${currentUser.company}.`
                        : option.blurb}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {!myLoveLetter ? (
              <section className="profile-card profile-cta-card">
                <div className="profile-card-header profile-card-header-column">
                  <span className="profile-kicker">Add Love Letter</span>
                  <h3>Give the profile a human voice.</h3>
                  <p className="profile-card-copy">
                    A Love Letter lets you say what Dex changed for you in your own words.
                  </p>
                </div>
                <button
                  type="button"
                  className="profile-primary-button"
                  onClick={handleLoveLetterReview}
                  disabled={startingLoveLetterReview}
                >
                  {startingLoveLetterReview ? 'Opening...' : 'Write your Love Letter'}
                </button>
              </section>
            ) : (
              <section className="profile-card profile-cta-card">
                <div className="profile-card-header profile-card-header-column">
                  <span className="profile-kicker">Love Letter</span>
                  <h3>Keep the human layer fresh.</h3>
                  <p className="profile-card-copy">
                    You already have a Love Letter on the profile. Open it whenever you want to tighten the wording.
                  </p>
                </div>
                <button
                  type="button"
                  className="profile-primary-button"
                  onClick={handleLoveLetterReview}
                  disabled={startingLoveLetterReview}
                >
                  {startingLoveLetterReview ? 'Opening...' : 'Edit Love Letter'}
                </button>
              </section>
            )}
          </div>
        </div>

        {isEmpty ? (
          <section className="empty-state">
            <h2>Share your first workflow</h2>
            <p>
              Dex helps you document and share how you use AI in your day-to-day work.
              Publish a diff from Dex and it will appear here immediately.
            </p>
          </section>
        ) : null}

        <section className="danger-zone">
          <h3>Danger Zone</h3>
          <p>Once you delete your account, there is no going back.</p>
          <button onClick={() => setShowDeleteModal(true)} className="profile-danger-button">
            Delete account
          </button>
        </section>
      </div>

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Delete your account?</h2>
            <p>This will permanently delete:</p>
            <ul>
              <li>Your profile</li>
              <li>All your diffs</li>
              <li>All adoption records</li>
              <li>Your authentication data</li>
            </ul>
            <p><strong>This cannot be undone.</strong></p>
            
            <div className="form-field">
              <label>Type your handle to confirm: <strong>@{currentUser.handle}</strong></label>
              <input
                type="text"
                placeholder={currentUser.handle}
                value={deleteConfirmHandle}
                onChange={e => setDeleteConfirmHandle(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="profile-secondary-button"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmHandle !== currentUser.handle}
                className="profile-danger-button"
              >
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
