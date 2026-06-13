import { isIsolatedEnabled } from './browser';

type QueueEntry = {
  accountId: string;
  resolve: () => void;
};

let activeAccount: string | null = null;
const waitingQueue: QueueEntry[] = [];

export const isBrowserQueueEnabled = (): boolean => !isIsolatedEnabled();

/**
 * When BROWSER_ISOLATED is false, only one account may use the shared system
 * browser at a time. Others wait here until the active account is verified.
 */
export const acquireBrowserSlot = (accountId: string): Promise<void> => {
  if (!isBrowserQueueEnabled()) return Promise.resolve();

  if (activeAccount === null || activeAccount === accountId) {
    activeAccount = accountId;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    waitingQueue.push({ accountId, resolve });
    console.log(
      `[browser-queue] "${accountId}" waiting for captcha browser (active: "${activeAccount}", ${waitingQueue.length} queued)`
    );
  });
};

/**
 * Release the browser slot after OwO sends a verification success message, or
 * when the captcha deadline passes without verification.
 */
export const releaseBrowserSlot = (accountId: string): void => {
  if (!isBrowserQueueEnabled()) return;

  const queuedIndex = waitingQueue.findIndex((entry) => entry.accountId === accountId);
  if (queuedIndex >= 0) {
    const [removed] = waitingQueue.splice(queuedIndex, 1);
    removed.resolve();
    console.log(`[browser-queue] "${accountId}" removed from wait queue`);
    return;
  }

  if (activeAccount !== accountId) return;

  activeAccount = null;
  const next = waitingQueue.shift();
  if (!next) {
    console.log('[browser-queue] browser slot released — queue empty');
    return;
  }

  activeAccount = next.accountId;
  console.log(`[browser-queue] browser slot granted to "${next.accountId}"`);
  next.resolve();
};
