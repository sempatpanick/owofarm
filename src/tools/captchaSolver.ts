import axios from 'axios';
import sleep from './sleep';

export type CaptchaService = 'capsolver' | 'capmonster' | '2captcha';

const OWO_SITEKEY = 'a6a1d5ce-612d-472d-8e37-7601408fbc09';
const OWO_WEBSITE = 'https://owobot.com';

const SERVICE_ENDPOINTS: Record<CaptchaService, { create: string; result: string }> = {
  capsolver: {
    create: 'https://api.capsolver.com/createTask',
    result: 'https://api.capsolver.com/getTaskResult',
  },
  capmonster: {
    create: 'https://api.capmonster.cloud/createTask',
    result: 'https://api.capmonster.cloud/getTaskResult',
  },
  '2captcha': {
    create: 'https://api.2captcha.com/createTask',
    result: 'https://api.2captcha.com/getTaskResult',
  },
};

const normalizeService = (service: string): CaptchaService => {
  const value = service.toLowerCase();
  if (value === 'capsolver' || value === 'capmonster' || value === '2captcha') return value;
  return 'capsolver';
};

const solveWithTaskApi = async (apiKey: string, service: CaptchaService, maxWaitMs: number): Promise<string | null> => {
  const endpoints = SERVICE_ENDPOINTS[service];

  try {
    const createRes = await axios.post(
      endpoints.create,
      {
        clientKey: apiKey,
        task: {
          type: 'HCaptchaTaskProxyLess',
          websiteKey: OWO_SITEKEY,
          websiteURL: OWO_WEBSITE,
        },
      },
      { validateStatus: () => true }
    );

    if (createRes.status === 401) {
      console.error(`[captcha] ${service} unauthorized — check CAPTCHA_API_KEY`);
      return null;
    }

    const taskId = createRes.data?.taskId;
    if (!taskId) {
      console.error(`[captcha] Failed to create ${service} task:`, createRes.data ?? createRes.status);
      return null;
    }

    console.log(`[captcha] ${service} task ${taskId} — waiting for solution...`);

    const pollIntervalMs = 2000;
    const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / pollIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollIntervalMs);

      const resultRes = await axios.post(
        endpoints.result,
        { clientKey: apiKey, taskId },
        { validateStatus: () => true }
      );

      const status = resultRes.data?.status;
      if (status === 'ready') {
        return resultRes.data?.solution?.gRecaptchaResponse ?? null;
      }

      if (status === 'failed' || resultRes.data?.errorId) {
        console.error(`[captcha] ${service} solve failed:`, resultRes.data);
        return null;
      }
    }

    console.error(`[captcha] ${service} timed out after ${Math.round(maxWaitMs / 1000)}s`);
    return null;
  } catch (error: any) {
    console.error('[captcha] Request error:', error.response?.data ?? error.message);
    return null;
  }
};

export const solveHcaptcha = async (
  apiKey: string,
  serviceName = 'capsolver',
  maxWaitMs = 90_000
): Promise<string | null> => {
  if (!apiKey) {
    console.error('[captcha] CAPTCHA_API_KEY is not set');
    return null;
  }

  const service = normalizeService(serviceName);
  return solveWithTaskApi(apiKey, service, maxWaitMs);
};
