import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const desktopPageSource = await readFile(
  new URL('../src/pages/DesktopPage.jsx', import.meta.url),
  'utf8',
);
const desktopPageStyles = await readFile(
  new URL('../src/pages/DesktopPage.module.css', import.meta.url),
  'utf8',
);

test('desktop page keeps the help rail and feedback walkthrough as page content', () => {
  assert.match(
    desktopPageSource,
    /<nav className=\{styles\.railNav\} aria-label="Desktop help and page navigation">/,
  );
  assert.match(desktopPageSource, /aria-label="Feedback loop"/);
  assert.match(desktopPageSource, /aria-label="Desktop feedback walkthrough"/);
  assert.match(
    desktopPageSource,
    /<section\s+id="desktop-start"[\s\S]*?aria-labelledby="desktop-start-title"/,
  );
  assert.match(
    desktopPageSource,
    /<section\s+id="desktop-feedback"[\s\S]*?aria-labelledby="desktop-feedback-title"/,
  );
  assert.doesNotMatch(desktopPageSource, /lightbox/);
  assert.match(desktopPageStyles, /\.constellation\s*\{[^}]*height: auto;/);
  assert.match(
    desktopPageStyles,
    /@media \(max-width: 980px\)\s*\{[\s\S]*?\.helpRail\s*\{[\s\S]*?position: sticky;/,
  );
});
