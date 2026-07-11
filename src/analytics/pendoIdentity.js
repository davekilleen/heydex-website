const identifiedEmails = new Set();

export function identifyPendoVisitor(email, pendo = globalThis.window?.pendo) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (
    !normalizedEmail ||
    typeof pendo?.identify !== 'function' ||
    identifiedEmails.has(normalizedEmail)
  ) {
    return;
  }

  identifiedEmails.add(normalizedEmail);

  try {
    pendo.identify({
      visitor: {
        id: normalizedEmail,
        email: normalizedEmail,
      },
      account: { id: 'heydex-website' },
    });
  } catch {
    // Analytics must never interrupt the application.
  }
}

export function identifyPendoVisitorAfterInitialization(
  email,
  browserWindow = globalThis.window,
) {
  let active = true;
  const identify = () => {
    if (active) identifyPendoVisitor(email, browserWindow?.pendo);
  };

  try {
    const ready = browserWindow?.dexPendoReady;
    if (ready && typeof ready.then === 'function') {
      ready.then(identify, identify);
    } else {
      identify();
    }
  } catch {
    identify();
  }

  return () => {
    active = false;
  };
}
