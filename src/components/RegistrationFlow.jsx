import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

// ── Function pill config ────────────────────────────
const FUNCTIONS = [
  { value: 'product', label: 'Product' },
  { value: 'sales', label: 'Sales' },
  { value: 'cs', label: 'CS' },
  { value: 'eng', label: 'Eng' },
  { value: 'marketing', label: 'Mktg' },
  { value: 'design', label: 'Design' },
  { value: 'founder', label: 'Founder' },
  { value: 'other', label: 'Other' },
];

const SENIORITIES = ['Manager', 'Director', 'VP', 'C-Suite', 'Founder'];

// ── Handle suggestion generator ─────────────────────
function generateSuggestions(name) {
  const parts = name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(' ')
    .filter(Boolean);
  if (!parts.length) return [];
  const first = parts[0];
  const last = parts[parts.length - 1] || '';
  const candidates = [
    first + last,
    first + '-' + last,
    (first[0] || '') + last,
    first + '-' + (last[0] || ''),
    last,
  ];
  const seen = new Set();
  return candidates.filter((v) => {
    if (!v || v.length < 2 || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

// ── Sanitise handle input ───────────────────────────
function sanitiseHandle(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

// ── SVG icons ───────────────────────────────────────
const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335" />
  </svg>
);

const MicrosoftLogo = () => (
  <svg width="18" height="18" viewBox="0 0 23 23" style={{ flexShrink: 0 }}>
    <rect x="1" y="1" width="10" height="10" fill="#f25022" />
    <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
    <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
    <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
  </svg>
);

const AppleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#f0f0f0" style={{ flexShrink: 0 }}>
    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
);

const LinkedInIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', flexShrink: 0 }} fill="#0A66C2">
    <path d="M15.34 1H2.66A1.65 1.65 0 001 2.66v12.68A1.65 1.65 0 002.66 17h12.68A1.65 1.65 0 0017 15.34V2.66A1.65 1.65 0 0015.34 1zM5.8 14.5H3.56V7.2H5.8v7.3zM4.68 6.22a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zM14.5 14.5h-2.24v-3.55c0-.85-.01-1.93-1.18-1.93s-1.36.92-1.36 1.87v3.61H7.48V7.2h2.15v1h.03a2.36 2.36 0 012.13-1.17c2.27 0 2.69 1.5 2.69 3.44v4.03z" />
  </svg>
);

// ── Provider button config ──────────────────────────
const PROVIDER_CONFIG = {
  google: { Logo: GoogleLogo, label: 'Continue with Google' },
  microsoft: { Logo: MicrosoftLogo, label: 'Continue with Microsoft' },
  apple: { Logo: AppleLogo, label: 'Continue with Apple' },
};

// ── Shared style constants ──────────────────────────
const S = {
  bgBase: '#0a0a0a',
  bgSurface: '#111111',
  bgElevated: '#161616',
  borderDefault: '#222222',
  borderStrong: '#333333',
  textPrimary: '#f0f0f0',
  textSecondary: '#888888',
  textTertiary: '#555555',
  textInverse: '#0a0a0a',
  accent: '#FF3870',
  accentDim: '#992244',
  accentBg: '#1f0f15',
  accentBorder: '#3d0a1e',
  error: '#ef4444',
  success: '#22c55e',
  fontMono: "'Geist Mono', 'Berkeley Mono', 'JetBrains Mono', monospace",
  fontSans: "'Geist', system-ui, sans-serif",
};

const styles = {
  pageMeta: {
    fontFamily: S.fontMono,
    fontSize: 11,
    color: S.textTertiary,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  pageTitle: {
    fontFamily: S.fontSans,
    fontSize: 20,
    fontWeight: 500,
    color: S.textPrimary,
    marginBottom: 8,
  },
  pageSubtitle: {
    fontFamily: S.fontSans,
    fontSize: 13,
    color: S.textSecondary,
    marginBottom: 32,
    lineHeight: 1.6,
  },
  fieldLabel: {
    fontFamily: S.fontMono,
    fontSize: 11,
    color: S.textTertiary,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    display: 'block',
    marginBottom: 4,
  },
  fieldInput: {
    width: '100%',
    padding: '8px 12px',
    fontFamily: S.fontMono,
    fontSize: 14,
    color: S.textPrimary,
    background: S.bgSurface,
    border: `1px solid ${S.borderDefault}`,
    borderRadius: 2,
    outline: 'none',
    caretColor: S.accent,
    transition: 'border-color 80ms ease',
  },
  submitBtn: {
    width: '100%',
    padding: '10px 16px',
    fontFamily: S.fontMono,
    fontSize: 13,
    fontWeight: 500,
    color: S.textInverse,
    background: S.accent,
    border: 'none',
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'opacity 80ms ease',
    marginTop: 8,
  },
  oauthBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '12px 16px',
    fontFamily: S.fontSans,
    fontSize: 14,
    fontWeight: 500,
    color: S.textPrimary,
    background: S.bgSurface,
    border: `1px solid ${S.borderDefault}`,
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'background 80ms ease, border-color 80ms ease',
    marginBottom: 12,
  },
  formError: {
    fontFamily: S.fontMono,
    fontSize: 12,
    color: S.error,
    marginTop: 8,
    minHeight: 16,
  },
  footer: {
    marginTop: 32,
    paddingTop: 16,
    borderTop: `1px solid ${S.borderDefault}`,
    textAlign: 'center',
  },
  footerLink: {
    fontFamily: S.fontMono,
    fontSize: 11,
    color: S.textTertiary,
    textDecoration: 'none',
    letterSpacing: '0.06em',
  },
};

// ── Global CSS injected once ────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600&family=Geist:wght@300;400;500;600&display=swap');

@keyframes rf-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 540px) {
  .rf-confirm-grid {
    grid-template-columns: 1fr !important;
  }
}
`;

function GlobalStyles() {
  return <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />;
}

// ── Cookie consent banner ───────────────────────────
function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('dexdiff-consent-dismissed')) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem('dexdiff-consent-dismissed', '1');
    setVisible(false);
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: S.bgSurface,
      borderTop: `1px solid ${S.borderDefault}`,
      padding: '16px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      zIndex: 100,
      fontFamily: S.fontSans,
      fontSize: 13,
      color: S.textSecondary,
    }}>
      <span>
        We use browser storage to keep you signed in.{' '}
        <a href="/privacy/" style={{ color: S.accent, textDecoration: 'none' }}>Privacy policy</a>
      </span>
      <button onClick={dismiss} style={{
        fontFamily: S.fontMono,
        fontSize: 12,
        fontWeight: 500,
        color: S.textInverse,
        background: S.accent,
        border: 'none',
        borderRadius: 2,
        padding: '6px 16px',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'opacity 80ms ease',
      }}>Got it</button>
    </div>
  );
}

// ── Footer link ─────────────────────────────────────
function Footer() {
  return (
    <div style={styles.footer}>
      <a href="/privacy/" style={styles.footerLink}>Privacy policy</a>
    </div>
  );
}

// ── Loading spinner (inline) ────────────────────────
function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 16,
      height: 16,
      border: `2px solid ${S.borderStrong}`,
      borderTopColor: S.accent,
      borderRadius: '50%',
      animation: 'rf-spin 0.6s linear infinite',
      verticalAlign: 'middle',
      marginRight: 8,
    }} />
  );
}

// ── Main component ──────────────────────────────────
export function RegistrationFlow({
  providers = ['google'],
  onOAuthSignIn,
  onEnrichProfile,
  onRegisterUser,
  onHandleChange,
  handleAvailability,
  isAuthenticated = false,
  isAuthLoading = false,
  currentUser,
  onRegistered,
  initialProfile,
  initialStep,
}) {
  const [step, setStep] = useState(initialStep || 'oauth');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [profileName, setProfileName] = useState(initialProfile?.displayName || initialProfile?.name || '');
  const [titleCompany, setTitleCompany] = useState(() => {
    const initialTitle = initialProfile?.title || initialProfile?.role;
    if (initialTitle && initialProfile?.company) {
      return `${initialTitle} at ${initialProfile.company}`;
    }
    return initialTitle || '';
  });
  const [selectedFunction, setSelectedFunction] = useState(initialProfile?.function_ || '');
  const [selectedSeniority, setSelectedSeniority] = useState(initialProfile?.seniority || '');
  const [summary, setSummary] = useState(initialProfile?.summary || '');
  const [handle, setHandle] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [isLoading, setIsLoading] = useState(null);
  const [error, setError] = useState('');
  const [enrichedLinkedinUrl, setEnrichedLinkedinUrl] = useState(initialProfile?.linkedinUrl || '');
  const [enrichedIndustry, setEnrichedIndustry] = useState(initialProfile?.industry || '');
  const [enrichedPhotoUrl, setEnrichedPhotoUrl] = useState(initialProfile?.photoUrl || initialProfile?.image || '');
  const hasEnrichedRef = useRef(false);
  const summaryRef = useRef(null);

  // ── Auto-step: skip oauth if already authenticated ──
  // DISABLED: Let users explicitly click through each step
  // useEffect(() => {
  //   if (initialStep) return;
  //   if (!isAuthLoading && isAuthenticated && currentUser === null) {
  //     setStep('linkedin');
  //   }
  // }, [isAuthenticated, isAuthLoading, currentUser, initialStep]);

  // ── Auto-advance after OAuth completes ──
  // After successful OAuth, move straight into registration.
  useEffect(() => {
    if (isAuthenticated && currentUser === null && step === 'oauth' && !isAuthLoading) {
      setStep('linkedin');
    }
  }, [isAuthenticated, currentUser, step, isAuthLoading]);

  // ── EU geolocation for marketing consent default ──
  useEffect(() => {
    if (step !== 'handle') return;
    fetch('https://ip-api.com/json/?fields=continentCode')
      .then((r) => r.json())
      .then((d) => {
        setMarketingOptIn(d.continentCode !== 'EU');
      })
      .catch(() => {
        // Default to opt-in if geolocation fails
        setMarketingOptIn(true);
      });
  }, [step]);

  // ── Handle change propagation ──
  const handleHandleChange = useCallback(
    (val) => {
      const clean = sanitiseHandle(val);
      setHandle(clean);
      if (onHandleChange && clean.length >= 2) {
        onHandleChange(clean);
      }
    },
    [onHandleChange],
  );

  // ── OAuth handler ──
  async function doOAuthSignIn(provider) {
    setIsLoading(provider);
    setError('');
    try {
      await onOAuthSignIn(provider);
    } catch (err) {
      setError(err.message || `${provider} sign-in failed`);
      setIsLoading(null);
    }
  }

  // ── LinkedIn enrichment handler ──
  async function doFindMe() {
    let url = linkedinUrl.trim();
    if (!url) {
      setError('Please enter your LinkedIn URL');
      return;
    }
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    if (!url.includes('linkedin.com/in/')) {
      setError('Please enter a valid LinkedIn profile URL');
      return;
    }
    setIsLoading('linkedin');
    setError('');
    try {
      const enriched = await onEnrichProfile(url);
      hasEnrichedRef.current = true;
      if (enriched.name) setProfileName(enriched.name);
      const tc = [enriched.title, enriched.company].filter(Boolean).join(' at ');
      if (tc) setTitleCompany(tc);
      if (enriched.function_) setSelectedFunction(enriched.function_.toLowerCase());
      if (enriched.seniority) {
        // Normalize seniority: API returns lowercase, UI expects capitalized
        const normalized = enriched.seniority.toLowerCase();
        const seniorityMap = {
          'manager': 'Manager',
          'director': 'Director',
          'vp': 'VP',
          'c-suite': 'C-Suite',
          'c-level': 'C-Suite',
          'founder': 'Founder',
        };
        setSelectedSeniority(seniorityMap[normalized] || '');
      }
      if (enriched.summary) setSummary(enriched.summary);
      setEnrichedLinkedinUrl(url);
      if (enriched.industry) setEnrichedIndustry(enriched.industry);
      if (enriched.photoUrl) setEnrichedPhotoUrl(enriched.photoUrl);
      setStep('profile');
    } catch (err) {
      setError(err.message || 'Failed to import LinkedIn profile');
    } finally {
      setIsLoading(null);
    }
  }

  // ── Skip LinkedIn ──
  function skipLinkedIn() {
    setStep('profile');
  }

  // ── Profile "Looks good" handler ──
  function doLooksGood() {
    setError('');
    if (!profileName.trim()) {
      setError('Name is required');
      return;
    }
    // Auto-generate handle from name
    const suggested = profileName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (suggested.length >= 2) {
      setHandle(suggested);
      if (onHandleChange) onHandleChange(suggested);
    }
    setStep('handle');
  }

  // ── Create account handler ──
  async function doCreateAccount() {
    setError('');
    if (!handle || handle.length < 2) {
      setError('Please choose a handle (at least 2 characters)');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(handle)) {
      setError('Handle must be lowercase letters, numbers, and hyphens only');
      return;
    }

    // Parse title & company from combined field
    let title = '';
    let company = '';
    const tc = titleCompany.trim();
    if (tc.includes(' at ')) {
      const parts = tc.split(' at ');
      title = parts[0].trim();
      company = parts.slice(1).join(' at ').trim();
    } else {
      title = tc;
    }

    setIsLoading('register');
    try {
      const args = {
        displayName: profileName.trim(),
        handle: handle.trim(),
        marketingOptOut: !marketingOptIn,
      };
      if (title) args.title = title;
      if (company) args.company = company;
      if (selectedSeniority) args.seniority = selectedSeniority;
      if (selectedFunction) args.function_ = selectedFunction;
      if (summary.trim()) args.summary = summary.trim();
      if (enrichedLinkedinUrl) args.linkedinUrl = enrichedLinkedinUrl;
      if (enrichedIndustry) args.industry = enrichedIndustry;
      if (enrichedPhotoUrl) args.photoUrl = enrichedPhotoUrl;

      await onRegisterUser(args);
      window.pendo?.track('registration_complete', { handle });
      onRegistered(handle);
    } catch (err) {
      setError(err.message || 'Registration failed');
      setIsLoading(null);
    }
  }

  // ── Handle suggestions ──
  const suggestionCandidates = generateSuggestions(profileName).filter(
    (candidate) => candidate !== handle
  );
  const suggestionAvailability = useQuery(
    api.users.checkHandles,
    step === 'handle' && suggestionCandidates.length > 0
      ? { handles: suggestionCandidates }
      : 'skip'
  );
  const suggestions =
    handleAvailability && handleAvailability.available === false && suggestionAvailability
      ? suggestionAvailability
          .filter((candidate) => candidate.available)
          .map((candidate) => candidate.handle)
      : [];

  // ── Auto-grow summary field so content is always fully visible ──
  useLayoutEffect(() => {
    if (!summaryRef.current) return;
    summaryRef.current.style.height = '0px';
    summaryRef.current.style.height = `${summaryRef.current.scrollHeight}px`;
  }, [summary, step]);

  // ── Determine page width ──
  const isProfileStep = step === 'profile';
  const pageMaxWidth = isProfileStep ? 640 : 400;

  return (
    <>
      <GlobalStyles />
      <div style={{
        minHeight: '100vh',
        width: '100%',
        background: S.bgBase,
        color: S.textPrimary,
        fontFamily: S.fontSans,
        fontSize: 14,
        lineHeight: 1.6,
        WebkitFontSmoothing: 'antialiased',
      }}>
        <div style={{
          maxWidth: pageMaxWidth,
          margin: '0 auto',
          padding: '80px 24px',
        }}>

          {/* ── LOADING STATE ──────────────────────── */}
          {step === 'oauth' && (isAuthLoading || (isAuthenticated && currentUser === null)) && (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <div style={{
                display: 'inline-block',
                width: 24,
                height: 24,
                border: `2px solid ${S.borderStrong}`,
                borderTopColor: S.accent,
                borderRadius: '50%',
                animation: 'rf-spin 0.6s linear infinite',
              }} />
              <p style={{ ...styles.pageSubtitle, marginTop: 16, marginBottom: 0 }}>
                {isAuthenticated ? 'Preparing your profile...' : 'Checking connection...'}
              </p>
            </div>
          )}

          {/* ── STEP: OAUTH ─────────────────────────── */}
          {step === 'oauth' && !isAuthLoading && !(isAuthenticated && currentUser === null) && (
            <div>
              <div style={styles.pageMeta}>HEYDEX.AI</div>

              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{
                  fontSize: 48,
                  color: S.accent,
                  marginBottom: 16,
                  lineHeight: 1,
                }}>&#9670;</div>
              </div>

              <h1 style={styles.pageTitle}>Connect to Dex</h1>
              <p style={styles.pageSubtitle}>
                Sign in to publish diffs, track adoptions, and see your company's AI map.
              </p>

              {providers.map((provider) => {
                const config = PROVIDER_CONFIG[provider];
                if (!config) return null;
                const { Logo, label } = config;
                const loading = isLoading === provider;
                return (
                  <button
                    key={provider}
                    onClick={() => doOAuthSignIn(provider)}
                    disabled={!!isLoading}
                    style={{
                      ...styles.oauthBtn,
                      opacity: isLoading && !loading ? 0.5 : 1,
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Logo />
                    {loading ? 'Redirecting...' : label}
                  </button>
                );
              })}

              {error && <div style={styles.formError}>{error}</div>}
              <Footer />
            </div>
          )}

          {/* ── STEP: LINKEDIN ──────────────────────── */}
          {step === 'linkedin' && (
            <div>
              <div style={styles.pageMeta}>HEYDEX.AI</div>
              <h1 style={styles.pageTitle}>Let's get to know you.</h1>

              <div style={{ marginTop: 24, marginBottom: 16 }}>
                <label style={styles.fieldLabel}>LinkedIn URL</label>
                <div style={{ position: 'relative' }}>
                  <LinkedInIcon />
                  <input
                    type="url"
                    placeholder="linkedin.com/in/yourprofile"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && doFindMe()}
                    disabled={isLoading === 'linkedin'}
                    style={{ ...styles.fieldInput, paddingLeft: 38 }}
                  />
                </div>
              </div>

              <p style={{
                fontFamily: S.fontSans,
                fontSize: 13,
                color: S.textSecondary,
                margin: '16px 0 24px',
                lineHeight: 1.6,
              }}>
                Dex uses your profile to build initial context about your company, role, and industry.
              </p>

              <button
                onClick={doFindMe}
                disabled={isLoading === 'linkedin'}
                style={{
                  ...styles.submitBtn,
                  opacity: isLoading === 'linkedin' ? 0.5 : 1,
                  cursor: isLoading === 'linkedin' ? 'not-allowed' : 'pointer',
                  marginTop: 0,
                }}
              >
                {isLoading === 'linkedin' ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner /> Fetching profile data...
                  </span>
                ) : (
                  'Find me \u{1F50D}'
                )}
              </button>

              {error && <div style={styles.formError}>{error}</div>}

              <p
                onClick={skipLinkedIn}
                style={{
                  fontFamily: S.fontSans,
                  fontSize: 13,
                  color: S.textTertiary,
                  textAlign: 'center',
                  marginTop: 24,
                  cursor: 'pointer',
                }}
              >
                I'd rather fill this in myself
              </p>

              <Footer />
            </div>
          )}

          {/* ── STEP: PROFILE ───────────────────────── */}
          {step === 'profile' && (
            <div>
              <div style={styles.pageMeta}>HEYDEX.AI</div>
              <h1 style={styles.pageTitle}>
                {hasEnrichedRef.current ? "Here's what we found." : 'Complete your profile.'}
              </h1>
              <p style={styles.pageSubtitle}>
                Dex uses this to personalise your briefings, meeting prep, and intelligence. Edit anything that doesn't look right.
              </p>

              <div
                className="rf-confirm-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0 32px',
                  alignItems: 'start',
                }}
              >
                {/* ── Left column ── */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.fieldLabel}>Name</label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                      style={styles.fieldInput}
                    />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.fieldLabel}>Title &amp; Company</label>
                    <input
                      type="text"
                      value={titleCompany}
                      onChange={(e) => setTitleCompany(e.target.value)}
                      placeholder="e.g., CPO at Acme Corp"
                      style={styles.fieldInput}
                    />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.fieldLabel}>Function</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {FUNCTIONS.map(({ value, label }) => {
                        const selected = selectedFunction === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSelectedFunction(selected ? '' : value)}
                            style={{
                              fontFamily: S.fontMono,
                              fontSize: 12,
                              color: selected ? S.textInverse : S.textSecondary,
                              background: selected ? S.accent : 'transparent',
                              border: `1px solid ${selected ? S.accent : S.borderDefault}`,
                              borderRadius: 2,
                              padding: '6px 14px',
                              cursor: 'pointer',
                              transition: 'all 80ms ease',
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ── Right column ── */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderLeft: `2px solid ${S.accent}`,
                  paddingLeft: 24,
                }}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.fieldLabel}>Seniority</label>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px 12px',
                    }}>
                      {SENIORITIES.map((level) => {
                        const isFounder = level === 'Founder';
                        return (
                          <label
                            key={level}
                            style={{
                              fontFamily: S.fontSans,
                              fontSize: 13,
                              color: S.textSecondary,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              ...(isFounder ? { gridColumn: '1 / -1' } : {}),
                            }}
                          >
                            <input
                              type="radio"
                              name="seniority"
                              value={level}
                              checked={selectedSeniority === level}
                              onChange={() => setSelectedSeniority(level)}
                              style={{ accentColor: S.accent, cursor: 'pointer' }}
                            />
                            {level}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <label style={styles.fieldLabel}>Summary</label>
                    <textarea
                      ref={summaryRef}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="A brief summary of what you do..."
                      style={{
                        ...styles.fieldInput,
                        fontFamily: S.fontSans,
                        resize: 'none',
                        overflow: 'hidden',
                        borderLeft: `3px solid ${S.accent}`,
                        borderRadius: '0 2px 2px 0',
                        paddingLeft: 14,
                        minHeight: '120px',
                      }}
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={doLooksGood}
                style={{
                  ...styles.submitBtn,
                  cursor: 'pointer',
                }}
              >
                Looks good
              </button>

              {error && <div style={styles.formError}>{error}</div>}
            </div>
          )}

          {/* ── STEP: HANDLE ────────────────────────── */}
          {step === 'handle' && (
            <div>
              <div style={styles.pageMeta}>HEYDEX.AI</div>
              <h1 style={styles.pageTitle}>Claim your handle.</h1>
              <p style={styles.pageSubtitle}>
                Your handle is your identity on DexDiff &mdash; it's how colleagues and the community find your workflows. When you share how you use AI, they'll find you at heydex.ai/@yourhandle
              </p>

              <div style={{ marginTop: 24, marginBottom: 16 }}>
                <label style={styles.fieldLabel}>Handle</label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontFamily: S.fontMono,
                    fontSize: 14,
                    color: S.textTertiary,
                  }}>@</span>
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => handleHandleChange(e.target.value)}
                    placeholder="yourhandle"
                    style={{ ...styles.fieldInput, paddingLeft: 28 }}
                  />
                </div>

                {/* ── Availability status ── */}
                <div style={{
                  fontFamily: S.fontMono,
                  fontSize: 12,
                  marginTop: 6,
                  minHeight: 18,
                }}>
                  {handle.length >= 2 && handleAvailability != null && (
                    handleAvailability.available ? (
                      <span style={{ color: S.success }}>&#10003; Available</span>
                    ) : (
                      <span style={{ color: S.error }}>Already taken</span>
                    )
                  )}
                </div>

                {/* ── Suggestions ── */}
                {suggestions.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{
                      fontFamily: S.fontMono,
                      fontSize: 11,
                      color: S.textTertiary,
                      marginBottom: 4,
                      display: 'block',
                    }}>Try one of these:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {suggestions.map((s) => (
                        <span
                          key={s}
                          onClick={() => handleHandleChange(s)}
                          style={{
                            fontFamily: S.fontMono,
                            fontSize: 11,
                            color: S.accent,
                            background: S.accentBg,
                            border: `1px solid ${S.accentBorder}`,
                            borderRadius: 2,
                            padding: '4px 10px',
                            cursor: 'pointer',
                            transition: 'background 80ms ease',
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Marketing consent ── */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginTop: 20,
                marginBottom: 16,
              }}>
                <input
                  type="checkbox"
                  id="marketing-consent"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  style={{ marginTop: 3, accentColor: S.accent, flexShrink: 0 }}
                />
                <label
                  htmlFor="marketing-consent"
                  style={{
                    fontFamily: S.fontSans,
                    fontSize: 13,
                    color: S.textSecondary,
                    cursor: 'pointer',
                  }}
                >
                  Keep me posted on Dex updates and new features
                </label>
              </div>

              <button
                onClick={doCreateAccount}
                disabled={isLoading === 'register'}
                style={{
                  ...styles.submitBtn,
                  opacity: isLoading === 'register' ? 0.5 : 1,
                  cursor: isLoading === 'register' ? 'not-allowed' : 'pointer',
                }}
              >
                {isLoading === 'register' ? 'Creating account...' : 'Create account'}
              </button>

              {error && <div style={styles.formError}>{error}</div>}
              <Footer />
            </div>
          )}
        </div>

        <ConsentBanner />
      </div>
    </>
  );
}

export default RegistrationFlow;
