import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getBrowserDiagnostics, openIsolatedUrl, profileDirFor } from '../src/tools/browser';

dotenv.config();

// Usage:
//   npm run simulate:browser                 -> profile label "test"
//   npm run simulate:browser -- myaccount    -> custom profile label
//   npm run simulate:browser -- myaccount https://owobot.com/captcha
const profileLabel = process.argv[2]?.trim() || 'test';
const targetUrl = process.argv[3]?.trim() || 'chrome://extensions/';

const diag = getBrowserDiagnostics();

console.log('--- Isolated browser diagnostics ---');
console.log('Isolated mode :', diag.isolated ? 'ON' : 'OFF (will use default system browser)');
console.log('Chrome exe    :', diag.executable ?? 'NOT FOUND — set BROWSER_EXECUTABLE');
console.log('Profiles dir  :', diag.profilesDir);
console.log('Profile label :', profileLabel, '->', profileDirFor(profileLabel));
console.log('Extension id  :', diag.extensionId ?? '(none set)');
console.log('Extension path:', diag.extensionPath ?? 'NOT FOUND — extension will NOT load');

if (diag.extensionPath) {
  const manifestPath = path.join(diag.extensionPath, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    console.log('Extension name:', manifest.name ?? '(unknown)', '| version:', manifest.version ?? '(unknown)');
  } catch {
    console.log('Extension name: (could not read manifest.json)');
  }
}

console.log('Opening URL   :', targetUrl);
console.log('------------------------------------');

if (!diag.isolated) {
  console.warn('BROWSER_ISOLATED is disabled — set BROWSER_ISOLATED=true to test isolation.');
}
if (!diag.extensionPath) {
  console.warn('No extension resolved — the browser will open but the captcha extension will be missing.');
}

openIsolatedUrl(targetUrl, profileLabel).then((opened) => {
  if (opened) {
    console.log(`\nLaunched isolated browser for "${profileLabel}".`);
    console.log('In the window that opened, confirm the extension is listed/enabled.');
    console.log('On chrome://extensions you should see the captcha-solver extension loaded (Developer mode).');
  } else {
    console.error('\nFailed to launch the isolated browser. Check the diagnostics above.');
    process.exit(1);
  }
});
