import { useAuthActions } from '@convex-dev/auth/react';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import Logomark from '../components/Logomark';
import { NIGHTFALL } from '../theme';
import styles from './BetaPage.module.css';

const USAGE_OPTIONS = [
  { value: 'not_installed', label: "Haven't installed it yet" },
  { value: 'tried_it', label: 'Tried it a few times' },
  { value: 'weekly', label: 'Use it most weeks' },
  { value: 'daily', label: "Daily — it's part of how I work" },
];

const CUSTOMIZATION_OPTIONS = [
  { value: 'stock', label: "Stock — haven't changed a thing" },
  { value: 'few_tweaks', label: 'A few tweaks' },
  { value: 'customized', label: 'Meaningfully customized' },
  {
    value: 'unrecognizable',
    label: 'Unrecognizable from the day I installed it',
  },
];

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function linkedinUsernameFrom(value) {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?linkedin\.com\/in\//i, '')
    .replace(/[/?#].*$/, '');
}

function PillGroup({ legend, name, options, value, onChange }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>{legend}</legend>
      <div className={styles.pills}>
        {options.map((option) => (
          <label
            className={`${styles.pill} ${value === option.value ? styles.pillSelected : ''}`}
            key={option.value}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PageShell({ children }) {
  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <div className={styles.brand}>HEYDEX.AI</div>
        <Logomark
          size={44}
          color={NIGHTFALL.accent}
          style={{ margin: '0 auto 24px' }}
        />
        {children}
        <footer className={styles.footer}>
          <a href="/privacy/">Privacy policy</a>
        </footer>
      </section>
    </main>
  );
}

function SignedOut({ onSignIn, busy, error }) {
  return (
    <PageShell>
      <div className={styles.meta}>Dex beta</div>
      <h1>Shape what comes next</h1>
      <p className={styles.intro}>
        Early access to the Dex Desktop app and DexDiff is opening soon.
        Sign in with Google so we know where to reach you.
      </p>
      <button
        className={styles.oauthButton}
        type="button"
        onClick={onSignIn}
        disabled={busy}
      >
        <GoogleLogo />
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </PageShell>
  );
}

function Success({ signup, onEdit }) {
  return (
    <PageShell>
      <div className={styles.successMark}>✓</div>
      <div className={styles.meta}>Request received</div>
      <h1>You&apos;re on the list</h1>
      <p className={styles.intro}>
        Check your inbox for confirmation. We&apos;ll be in touch as the Dex
        Desktop app and DexDiff betas open up.
      </p>
      <div className={styles.summary}>
        <div>
          <span>Dex usage</span>
          <strong>{optionLabel(USAGE_OPTIONS, signup.usageLevel)}</strong>
        </div>
        <div>
          <span>Customization</span>
          <strong>
            {optionLabel(CUSTOMIZATION_OPTIONS, signup.customization)}
          </strong>
        </div>
        {signup.liked ? (
          <div>
            <span>What&apos;s working</span>
            <strong>{signup.liked}</strong>
          </div>
        ) : null}
        {signup.frustrations ? (
          <div>
            <span>What could be better</span>
            <strong>{signup.frustrations}</strong>
          </div>
        ) : null}
        {signup.linkedinUsername ? (
          <div>
            <span>LinkedIn</span>
            <strong>linkedin.com/in/{signup.linkedinUsername}</strong>
          </div>
        ) : null}
      </div>
      <button className={styles.secondaryButton} type="button" onClick={onEdit}>
        Update my answers
      </button>
    </PageShell>
  );
}

export default function BetaPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const mine = useQuery(api.betaSignups.mine, isAuthenticated ? {} : 'skip');
  const submitSignup = useMutation(api.betaSignups.submit);
  const enrichProfile = useAction(api.enrichment.enrichProfile);

  const [editing, setEditing] = useState(false);
  const [usageLevel, setUsageLevel] = useState('');
  const [liked, setLiked] = useState('');
  const [frustrations, setFrustrations] = useState('');
  const [customization, setCustomization] = useState('');
  const [linkedinUsername, setLinkedinUsername] = useState('');
  const [enriched, setEnriched] = useState(null);
  const [linkedinConfirmed, setLinkedinConfirmed] = useState(false);
  const [enrichmentNotice, setEnrichmentNotice] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const [submittedSignup, setSubmittedSignup] = useState(null);

  useEffect(() => {
    if (!mine) return;
    setUsageLevel(mine.usageLevel);
    setLiked(mine.liked ?? '');
    setFrustrations(mine.frustrations ?? '');
    setCustomization(mine.customization);
    setLinkedinUsername(mine.linkedinUsername ?? '');
    if (mine.linkedinUrl) {
      setEnriched({
        name: mine.name,
        linkedinUrl: mine.linkedinUrl,
        title: mine.enrichedTitle,
        company: mine.enrichedCompany,
        industry: mine.enrichedIndustry,
        photoUrl: mine.enrichedPhotoUrl,
        summary: mine.enrichedSummary,
      });
      setLinkedinConfirmed(true);
    }
  }, [mine]);

  async function handleSignIn() {
    setSigningIn(true);
    setError('');
    try {
      const redirectTo = window.location.href;
      localStorage.setItem('auth_redirect_to', redirectTo);
      await signIn('google', { redirectTo });
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : 'Google sign-in could not start. Please try again.',
      );
      setSigningIn(false);
    }
  }

  function handleLinkedinChange(event) {
    setLinkedinUsername(linkedinUsernameFrom(event.target.value));
    setEnriched(null);
    setLinkedinConfirmed(false);
    setEnrichmentNotice('');
  }

  async function handleLookup() {
    const username = linkedinUsernameFrom(linkedinUsername);
    if (!username) {
      setEnrichmentNotice('Add a LinkedIn username first.');
      return;
    }

    setLinkedinUsername(username);
    setEnriching(true);
    setEnrichmentNotice('');
    try {
      const result = await enrichProfile({ linkedinUrl: username });
      setEnriched(result);
      setLinkedinConfirmed(false);
      if (result.warning) {
        setEnrichmentNotice(
          "We couldn't confirm that profile, but you can still submit your request.",
        );
      }
    } catch {
      setEnriched(null);
      setEnrichmentNotice(
        "We couldn't look that profile up just now. You can still submit your request.",
      );
    } finally {
      setEnriching(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!usageLevel || !customization) {
      setError('Choose your Dex usage and customization level to continue.');
      return;
    }

    const username = linkedinUsernameFrom(linkedinUsername);
    setSubmitting(true);
    try {
      await submitSignup({
        usageLevel,
        liked: liked.trim() || undefined,
        frustrations: frustrations.trim() || undefined,
        customization,
        linkedinUsername: username || undefined,
        linkedinUrl: linkedinConfirmed ? enriched?.linkedinUrl : undefined,
        enrichedTitle: linkedinConfirmed ? enriched?.title : undefined,
        enrichedCompany: linkedinConfirmed ? enriched?.company : undefined,
        enrichedIndustry: linkedinConfirmed ? enriched?.industry : undefined,
        enrichedPhotoUrl: linkedinConfirmed ? enriched?.photoUrl : undefined,
        enrichedSummary: linkedinConfirmed ? enriched?.summary : undefined,
        source: 'beta-page',
      });

      setSubmittedSignup({
        ...(mine ?? {}),
        usageLevel,
        liked: liked.trim() || undefined,
        frustrations: frustrations.trim() || undefined,
        customization,
        linkedinUsername: username || undefined,
      });
      setEditing(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Your request could not be saved. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <PageShell>
        <p className={styles.loading}>Checking your sign-in…</p>
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignedOut
        onSignIn={handleSignIn}
        busy={signingIn}
        error={error}
      />
    );
  }

  if (mine === undefined && !submittedSignup) {
    return (
      <PageShell>
        <p className={styles.loading}>Loading your beta request…</p>
      </PageShell>
    );
  }

  const successSignup = submittedSignup ?? mine;
  if (successSignup && !editing) {
    return (
      <Success
        signup={successSignup}
        onEdit={() => {
          setSubmittedSignup(null);
          setEditing(true);
        }}
      />
    );
  }

  return (
    <PageShell>
      <div className={styles.meta}>Dex beta</div>
      <h1>Tell us how Dex fits your work</h1>
      <p className={styles.intro}>
        A few quick answers help us open the beta to the right people and
        shape the experience around how Dex is really used.
      </p>

      <form onSubmit={handleSubmit}>
        <PillGroup
          legend="How often do you use Dex?"
          name="usageLevel"
          options={USAGE_OPTIONS}
          value={usageLevel}
          onChange={setUsageLevel}
        />

        <label className={styles.field}>
          <span className={styles.label}>
            What have you liked about Dex so far?
          </span>
          <textarea
            value={liked}
            onChange={(event) => setLiked(event.target.value)}
            rows={4}
          />
          <small>Optional, but even a sentence helps us know what to protect.</small>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            Anything frustrating or confusing?
          </span>
          <textarea
            value={frustrations}
            onChange={(event) => setFrustrations(event.target.value)}
            rows={4}
          />
        </label>

        <PillGroup
          legend="How customized is your Dex?"
          name="customization"
          options={CUSTOMIZATION_OPTIONS}
          value={customization}
          onChange={setCustomization}
        />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="linkedin-username">
            LinkedIn <span>· optional</span>
          </label>
          <div className={styles.linkedinRow}>
            <div className={styles.linkedinInput}>
              <span>linkedin.com/in/</span>
              <input
                id="linkedin-username"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="your-username"
                value={linkedinUsername}
                onChange={handleLinkedinChange}
              />
            </div>
            <button
              className={styles.lookupButton}
              type="button"
              onClick={handleLookup}
              disabled={enriching || !linkedinUsername}
            >
              {enriching ? 'Looking…' : 'Look me up'}
            </button>
          </div>
          {enrichmentNotice ? (
            <p className={styles.notice} aria-live="polite">{enrichmentNotice}</p>
          ) : null}
        </div>

        {enriched && !enriched.warning ? (
          <div className={styles.preview}>
            {enriched.photoUrl ? (
              <img src={enriched.photoUrl} alt="" />
            ) : (
              <div className={styles.avatarFallback}>
                {enriched.name?.charAt(0) || '?'}
              </div>
            )}
            <div className={styles.previewCopy}>
              <strong>{enriched.name}</strong>
              {(enriched.title || enriched.company) ? (
                <span>
                  {[enriched.title, enriched.company]
                    .filter(Boolean)
                    .join(' @ ')}
                </span>
              ) : null}
            </div>
            {linkedinConfirmed ? (
              <span className={styles.confirmed}>That&apos;s me ✓</span>
            ) : (
              <div className={styles.previewActions}>
                <button
                  type="button"
                  onClick={() => setLinkedinConfirmed(true)}
                >
                  That&apos;s me
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEnriched(null);
                    setLinkedinConfirmed(false);
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button
          className={styles.submitButton}
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Saving your request…' : 'Request beta access'}
        </button>
      </form>
    </PageShell>
  );
}
