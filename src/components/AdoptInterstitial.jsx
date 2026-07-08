import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import './AdoptInterstitial.css';

const LAUNCH_TIMEOUT_MS = 2500;

function normalizeHandle(handle) {
  return String(handle || '').trim().replace(/^@/, '');
}

function buildTargets(handle, diffId) {
  const normalizedHandle = normalizeHandle(handle);
  const displayHandle = `@${normalizedHandle}`;
  const encodedDiffId = diffId ? encodeURIComponent(diffId) : '';

  return {
    deepLink: diffId
      ? `dex://adopt/${displayHandle}/${encodedDiffId}`
      : `dex://adopt/${displayHandle}`,
    command: diffId
      ? `/diff-adopt ${displayHandle}/${diffId}`
      : `/diff-adopt-profile ${displayHandle}`,
  };
}

function appendGrant(deepLink, code) {
  return `${deepLink}?grant=${encodeURIComponent(code)}`;
}

export default function AdoptInterstitial({
  handle,
  diffId,
  triggerLabel = 'Open in Dex',
  buttonClassName = '',
}) {
  const { isAuthenticated } = useConvexAuth();
  const generateGrant = useMutation(api.adopt.generateGrant);
  const titleId = useId();
  const dialogRef = useRef(null);
  const cleanupAttemptRef = useRef(null);
  const copyResetRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState('idle');
  const [copied, setCopied] = useState(false);
  const { command, deepLink } = useMemo(
    () => buildTargets(handle, diffId),
    [diffId, handle],
  );

  function cleanupAttempt() {
    if (cleanupAttemptRef.current) {
      cleanupAttemptRef.current();
      cleanupAttemptRef.current = null;
    }
  }

  function closeInterstitial() {
    cleanupAttempt();
    setIsOpen(false);
    setStatus('idle');
    setCopied(false);
  }

  async function resolveLaunchDeepLink() {
    if (!isAuthenticated) {
      return deepLink;
    }

    try {
      const grant = await generateGrant({ targetHandle: normalizeHandle(handle) });
      if (grant?.code) {
        return appendGrant(deepLink, grant.code);
      }
    } catch (error) {
      console.warn('[adopt] grant mint failed; falling back to no-grant link', error);
    }

    return deepLink;
  }

  async function startAttempt() {
    setIsOpen(true);
    setStatus('attempting');
    setCopied(false);

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    cleanupAttempt();

    const launchDeepLink = await resolveLaunchDeepLink();
    let settled = false;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.display = 'none';

    function finish(nextStatus) {
      if (settled) return;
      settled = true;
      cleanupAttempt();
      setStatus(nextStatus);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        finish('success');
      }
    }

    const handleBlur = () => finish('success');
    const timeoutId = window.setTimeout(() => finish('fallback'), LAUNCH_TIMEOUT_MS);

    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    cleanupAttemptRef.current = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      iframe.remove();
    };

    iframe.src = launchDeepLink;
    document.body.appendChild(iframe);
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);

    if (copyResetRef.current) {
      window.clearTimeout(copyResetRef.current);
    }

    copyResetRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetRef.current = null;
    }, 1500);
  }

  useEffect(() => {
    return () => {
      cleanupAttempt();
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closeInterstitial();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        className={['adopt-interstitial-trigger', buttonClassName].filter(Boolean).join(' ')}
        onClick={startAttempt}
      >
        {triggerLabel}
      </button>

      {isOpen ? (
        <div className="adopt-interstitial-overlay">
          <div
            ref={dialogRef}
            className="adopt-interstitial-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <button
              type="button"
              className="adopt-interstitial-close"
              onClick={closeInterstitial}
              aria-label="Close"
            >
              Close
            </button>

            {status === 'attempting' ? (
              <div className="adopt-interstitial-state">
                <div className="adopt-interstitial-label">Open in Dex</div>
                <h2 id={titleId}>Opening Dex...</h2>
                <p>Waiting for Dex to take over.</p>
              </div>
            ) : null}

            {status === 'success' ? (
              <div className="adopt-interstitial-state">
                <div className="adopt-interstitial-label">Open in Dex</div>
                <h2 id={titleId}>Opened in Dex ✓</h2>
                <p>Dex accepted the handoff from this browser.</p>
              </div>
            ) : null}

            {status === 'fallback' ? (
              <div className="adopt-interstitial-state">
                <div className="adopt-interstitial-label">Open in Dex</div>
                <h2 id={titleId}>Didn't open?</h2>
                <p>
                  The browser cannot tell whether Dex is missing or the system prompt was
                  dismissed. Use either option below.
                </p>

                <a
                  href="https://heydex.ai/desktop/"
                  className="adopt-interstitial-download"
                >
                  Download Dex for Mac
                </a>

                <div className="adopt-interstitial-command-surface">
                  <div className="adopt-interstitial-command-label">Terminal command</div>
                  <div className="adopt-interstitial-command-row">
                    <code className="adopt-interstitial-command-text">{command}</code>
                    <button
                      type="button"
                      className="adopt-interstitial-command-action"
                      onClick={copyCommand}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
