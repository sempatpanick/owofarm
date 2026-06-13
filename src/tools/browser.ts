import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import openUrl from './openUrl';

const DEFAULT_PROFILES_DIR = './browser-profiles';
const EXTENSION_CACHE_DIR = '.extension-cache';

export const isIsolatedEnabled = (): boolean => {
  const raw = process.env.BROWSER_ISOLATED?.trim().toLowerCase();
  // Isolated mode is the default; only an explicit "false"/"0"/"no" disables it.
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
};

const getProfilesDir = (): string => {
  const dir = process.env.BROWSER_PROFILES_DIR?.trim() || DEFAULT_PROFILES_DIR;
  return path.resolve(process.cwd(), dir);
};

const fileExists = (target?: string): boolean => {
  if (!target) return false;
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
};

const hasManifest = (dir: string): boolean => fileExists(path.join(dir, 'manifest.json'));

const resolveChromeExecutable = (): string | null => {
  const fromEnv = process.env.BROWSER_EXECUTABLE?.trim();
  if (fromEnv) return fileExists(fromEnv) ? fromEnv : null;

  const candidatesByPlatform: Record<string, string[]> = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    win32: [
      `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };

  const candidates = candidatesByPlatform[process.platform] ?? [];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
};

// Resolve a directory that contains a manifest.json at its root so it can be
// passed to Chrome's --load-extension flag. Handles both unpacked extensions
// and the installed "Extensions/<id>/<version>" layout.
const resolveExtensionPath = (profilesDir: string): string | null => {
  const extensionId = process.env.BROWSER_EXTENSION_ID?.trim();

  const candidates = [
    process.env.BROWSER_EXTENSION_PATH?.trim(),
    extensionId ? path.join(profilesDir, EXTENSION_CACHE_DIR, extensionId) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!fileExists(candidate)) continue;
    if (hasManifest(candidate)) return candidate;

    // Installed layout: pick the newest version subfolder that has a manifest.
    try {
      const versionDirs = fs
        .readdirSync(candidate, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(candidate, entry.name))
        .filter(hasManifest)
        .sort();
      if (versionDirs.length > 0) return versionDirs[versionDirs.length - 1];
    } catch {
      // ignore and try next candidate
    }
  }

  return null;
};

const sanitizeProfileLabel = (label: string): string => {
  const cleaned = label.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '').trim();
  return cleaned || 'default';
};

/**
 * Opens a URL in a dedicated, isolated Chrome instance for the given account.
 *
 * Each account gets its own --user-data-dir so cookies/sessions never collide,
 * while the captcha-solver extension is still loaded via --load-extension.
 * Falls back to the system default browser if isolation is disabled or Chrome
 * cannot be located.
 */
export const openIsolatedUrl = (url: string, profileLabel: string): Promise<boolean> => {
  if (!isIsolatedEnabled()) return openUrl(url);

  const executable = resolveChromeExecutable();
  if (!executable) {
    console.error('[browser] No Chrome executable found — set BROWSER_EXECUTABLE. Falling back to default browser.');
    return openUrl(url);
  }

  const profilesDir = getProfilesDir();
  const userDataDir = path.join(profilesDir, sanitizeProfileLabel(profileLabel));

  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (error) {
    console.error('[browser] Could not create profile dir, falling back to default browser:', error);
    return openUrl(url);
  }

  const args = [
    `--user-data-dir=${userDataDir}`,
    '--profile-directory=Default',
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  const extensionPath = resolveExtensionPath(profilesDir);
  if (extensionPath) {
    args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  } else {
    console.error('[browser] Extension not found — opening isolated profile WITHOUT captcha extension.');
  }

  args.push(url);

  return new Promise((resolve) => {
    try {
      const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (error) => {
        console.error('[browser] Failed to launch isolated Chrome, falling back:', error.message);
        openUrl(url).then(resolve);
      });
      child.unref();
      // spawn errors arrive asynchronously; assume success once detached.
      setTimeout(() => resolve(true), 300);
    } catch (error: any) {
      console.error('[browser] Launch error, falling back to default browser:', error?.message ?? error);
      openUrl(url).then(resolve);
    }
  });
};

export type BrowserDiagnostics = {
  isolated: boolean;
  executable: string | null;
  profilesDir: string;
  extensionId?: string;
  extensionPath: string | null;
};

/**
 * Resolves the same configuration openIsolatedUrl() would use, without
 * launching anything. Useful for diagnostics / simulation scripts.
 */
export const getBrowserDiagnostics = (): BrowserDiagnostics => {
  const profilesDir = getProfilesDir();
  return {
    isolated: isIsolatedEnabled(),
    executable: resolveChromeExecutable(),
    profilesDir,
    extensionId: process.env.BROWSER_EXTENSION_ID?.trim(),
    extensionPath: resolveExtensionPath(profilesDir),
  };
};

export const profileDirFor = (profileLabel: string): string =>
  path.join(getProfilesDir(), sanitizeProfileLabel(profileLabel));

export default openIsolatedUrl;
