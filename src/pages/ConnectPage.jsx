import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useAction, useMutation, useQuery } from 'convex/react';
import { useState, useEffect } from 'react';
import { RegistrationFlow } from '../components/RegistrationFlow';
import Logomark from '../components/Logomark';
import { api } from '../../convex/_generated/api';
import { NIGHTFALL } from '../theme';

const DEFAULT_AUTH_PROVIDERS = 'google,microsoft,apple';

function parseAuthProviders(rawProviders) {
  return rawProviders
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean);
}

const AUTH_PROVIDERS = parseAuthProviders(
  import.meta.env.VITE_AUTH_PROVIDERS ?? DEFAULT_AUTH_PROVIDERS,
);

const CLI_PROVIDER_LABELS = {
  google: 'Continue with Google',
  microsoft: 'Continue with Microsoft',
  apple: 'Continue with Apple',
};

function formatProviderName(provider) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function CliProviderLogo({ provider }) {
  if (provider === 'google') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
        <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335" />
      </svg>
    );
  }

  if (provider === 'microsoft') {
    return (
      <svg width="18" height="18" viewBox="0 0 23 23">
        <rect x="1" y="1" width="10" height="10" fill="#f25022" />
        <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
        <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
        <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
      </svg>
    );
  }

  if (provider === 'apple') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill={NIGHTFALL.textPrimary}>
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    );
  }

  return null;
}

export default function ConnectPage() {
  const [currentHandle, setCurrentHandle] = useState('');
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  
  // CLI auth flow state
  const params = new URLSearchParams(window.location.search);
  const isCLI = params.get('cli') === 'true';
  const [code, setCode] = useState(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [cliError, setCliError] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  
  const generateCode = useMutation(api.connect.generateCode);

  const enrich = useAction(api.enrichment.enrichProfile);
  const register = useMutation(api.users.register);
  const currentUser = useQuery(api.users.me);
  const handleCheck = useQuery(
    api.users.checkHandle,
    currentHandle.length >= 2 ? { handle: currentHandle } : 'skip',
  );

  const returnUrl = params.get('return') || '/diff/';
  const postRegistrationUrl = params.get('return') || '/diff/profile/';

  async function handleGenerateCode() {
    setIsGeneratingCode(true);
    setCliError('');
    try {
      const result = await generateCode();
      setCode(result.code);
    } catch (error) {
      setCliError(error instanceof Error ? error.message : 'Failed to generate connection code');
    } finally {
      setIsGeneratingCode(false);
    }
  }
  
  // ── Redirect returning users who are already registered ──
  // Only redirect if they have completed registration (have a handle)
  // Skip redirect in CLI mode (show code instead)
  useEffect(() => {
    if (!isCLI && !isLoading && isAuthenticated && currentUser) {
      window.location.href = returnUrl;
    }
  }, [isCLI, isLoading, isAuthenticated, currentUser, returnUrl]);
  
  // ── Show registration form for authenticated users without a profile ──
  // If isAuthenticated but currentUser is null, they need to complete registration
  const showRegistrationForm = isAuthenticated && !isLoading && !currentUser;

  async function handleCliSignOut() {
    await signOut();
    window.location.href = '/connect/?cli=true';
  }

  async function handleCopyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1500);
  }
  
  async function onOAuthSignIn(provider) {
    // ConvexAuth handles the full redirect flow; provider names map directly.
    // Store redirect URL for recovery if callback gets stuck
    const redirectUrl = window.location.href;
    localStorage.setItem('auth_redirect_to', redirectUrl);
    await signIn(provider, { redirectTo: redirectUrl });
  }

  async function onEnrichProfile(linkedinUrl) {
    return await enrich({ linkedinUrl });
  }

  async function onRegisterUser(args) {
    await register(args);
  }

  function onRegistered() {
    window.pendo?.track('registration_complete');
    window.location.href = postRegistrationUrl;
  }

  // ── CLI Authentication Flow ──
  if (isCLI) {
    if (!isAuthenticated) {
      return (
        <div style={{
          minHeight: '100vh',
          width: '100%',
          background: NIGHTFALL.bgBase,
          color: NIGHTFALL.textPrimary,
          fontFamily: NIGHTFALL.fontSans,
          fontSize: 14,
          lineHeight: 1.6,
        }}>
          <div style={{
            maxWidth: 400,
            margin: '0 auto',
            padding: '80px 24px',
          }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: NIGHTFALL.textTertiary, marginBottom: 32, textAlign: 'center' }}>HEYDEX.AI</div>
            
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <Logomark size={44} color={NIGHTFALL.accent} style={{ margin: '0 auto 16px' }} />
            </div>

            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16, textAlign: 'center' }}>Connect Dex to Heydex</h1>
            <p style={{ fontSize: 14, color: NIGHTFALL.textSecondary, marginBottom: 32, textAlign: 'center' }}>
              Sign in once to connect your Dex app and your Heydex profile.
            </p>
            
            {AUTH_PROVIDERS.map((provider) => (
              <button
                key={provider}
                onClick={() => onOAuthSignIn(provider)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '12px 20px',
                  background: NIGHTFALL.bgSurface,
                  color: NIGHTFALL.textPrimary,
                  border: `1px solid ${NIGHTFALL.borderDefault}`,
                  borderRadius: NIGHTFALL.radius,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                  marginBottom: 12,
                }}
                onMouseOver={(e) => e.currentTarget.style.background = NIGHTFALL.bgElevated}
                onMouseOut={(e) => e.currentTarget.style.background = NIGHTFALL.bgSurface}
              >
                <CliProviderLogo provider={provider} />
                {CLI_PROVIDER_LABELS[provider] ?? `Continue with ${formatProviderName(provider)}`}
              </button>
            ))}
          </div>
        </div>
      );
    }
    
    if (isGeneratingCode && !code) {
      return (
        <div style={{
          minHeight: '100vh',
          background: NIGHTFALL.bgBase,
          color: NIGHTFALL.textPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ maxWidth: '400px', padding: '2rem', textAlign: 'center' }}>
            <div style={{
              display: 'inline-block',
              width: 24,
              height: 24,
              border: `2px solid ${NIGHTFALL.borderStrong}`,
              borderTopColor: NIGHTFALL.accent,
              borderRadius: '50%',
              animation: 'spin 0.6s linear infinite',
              marginBottom: 24,
            }} />
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16, color: NIGHTFALL.textPrimary }}>Creating your sign-in code</h1>
            <p style={{ color: NIGHTFALL.textSecondary, fontSize: 14 }}>This usually takes a second or two.</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      );
    }
    
    if (!code) {
      return (
        <div style={{
          minHeight: '100vh',
          background: NIGHTFALL.bgBase,
          color: NIGHTFALL.textPrimary,
          fontFamily: NIGHTFALL.fontSans,
        }}>
          <div style={{ maxWidth: '400px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: NIGHTFALL.textTertiary, marginBottom: 32 }}>HEYDEX.AI</div>

            <Logomark size={44} color={NIGHTFALL.accent} style={{ margin: '0 auto 32px' }} />

            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>You&apos;re signed in</h1>
            <p style={{ fontSize: 14, color: NIGHTFALL.textSecondary, marginBottom: 32 }}>
              Next, create a short one-time code. You&apos;ll paste it back into Dex to finish connecting.
            </p>

            {cliError ? (
              <div style={{
                marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: NIGHTFALL.radius,
                color: NIGHTFALL.statusError,
                fontSize: 13,
                textAlign: 'left',
              }}>
                {cliError}
              </div>
            ) : null}

            <button
              onClick={handleGenerateCode}
              style={{
                padding: '12px 24px',
                background: NIGHTFALL.accent,
                color: NIGHTFALL.accentFillText,
                border: 'none',
                borderRadius: NIGHTFALL.radius,
                cursor: 'pointer',
                marginBottom: 16,
                width: '100%',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Create sign-in code
            </button>

            <button
              onClick={handleCliSignOut}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                color: NIGHTFALL.textSecondary,
                border: `1px solid ${NIGHTFALL.borderDefault}`,
                borderRadius: NIGHTFALL.radius,
                cursor: 'pointer',
                width: '100%',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Use a different account
            </button>
          </div>
        </div>
      );
    }
    
    return (
      <div style={{
        minHeight: '100vh',
        background: NIGHTFALL.bgBase,
        color: NIGHTFALL.textPrimary,
        fontFamily: NIGHTFALL.fontSans,
      }}>
        <div style={{ maxWidth: '400px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', color: NIGHTFALL.textTertiary, marginBottom: 32 }}>HEYDEX.AI</div>
          
          <Logomark size={44} color={NIGHTFALL.accent} style={{ margin: '0 auto 32px' }} />

          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Your sign-in code</h1>
          <p style={{ fontSize: 14, color: NIGHTFALL.textSecondary, marginBottom: 32 }}>
            Copy this code, go back to Dex, and paste it when Dex asks for it.
          </p>
          
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            padding: '24px',
            background: NIGHTFALL.bgSurface,
            border: `1px solid ${NIGHTFALL.borderDefault}`,
            borderRadius: NIGHTFALL.radius,
            marginBottom: 16,
            letterSpacing: '0.2em',
            color: NIGHTFALL.textPrimary
          }}>
            {code || '------'}
          </div>
          
          {cliError ? (
            <div style={{
              marginBottom: 16,
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: NIGHTFALL.radius,
              color: NIGHTFALL.statusError,
              fontSize: 13,
              textAlign: 'left',
            }}>
              {cliError}
            </div>
          ) : null}

          <div style={{
            textAlign: 'left',
            background: NIGHTFALL.bgSurface,
            border: `1px solid ${NIGHTFALL.borderDefault}`,
            borderRadius: NIGHTFALL.radius,
            padding: '16px',
            marginBottom: 16,
          }}>
            <div style={{ color: NIGHTFALL.textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              What happens next
            </div>
            <div style={{ color: NIGHTFALL.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
              1. Copy this code.
              <br />
              2. Go back to Dex in Cursor, Claude Code, or the app you started from.
              <br />
              3. Paste the code there.
              <br />
              4. Dex will finish the connection automatically.
              <br />
              5. This code stays valid for 30 minutes.
            </div>
          </div>

          <button 
            onClick={handleCopyCode}
            disabled={!code}
            style={{
              padding: '12px 24px',
              background: NIGHTFALL.accent,
              color: NIGHTFALL.accentFillText,
              border: 'none',
              borderRadius: NIGHTFALL.radius,
              marginBottom: 24,
              width: '100%',
              fontSize: 14,
              fontWeight: 500,
              opacity: code ? 1 : 0.5,
              cursor: code ? 'pointer' : 'not-allowed',
            }}
          >
            {copiedCode ? 'Copied' : 'Copy code'}
          </button>

          <button
            onClick={handleCliSignOut}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              color: NIGHTFALL.textSecondary,
              border: `1px solid ${NIGHTFALL.borderDefault}`,
              borderRadius: NIGHTFALL.radius,
              cursor: 'pointer',
              width: '100%',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Use a different account
          </button>
        </div>
      </div>
    );
  }
  
  // ── Regular Registration Flow ──
  return (
    <RegistrationFlow
      providers={AUTH_PROVIDERS}
      onOAuthSignIn={onOAuthSignIn}
      onEnrichProfile={onEnrichProfile}
      onRegisterUser={onRegisterUser}
      onHandleChange={setCurrentHandle}
      handleAvailability={handleCheck}
      isAuthenticated={isAuthenticated}
      isAuthLoading={isLoading}
      currentUser={currentUser}
      onRegistered={onRegistered}
    />
  );
}
