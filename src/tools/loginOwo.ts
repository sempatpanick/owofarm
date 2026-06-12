import axios from 'axios';
import dotenv from 'dotenv';
import { solveHcaptcha } from './captchaSolver';

dotenv.config();

const OWO_CLIENT_ID = '408785106942164992';
const OWO_REDIRECT_URI = 'https://owobot.com/api/auth/discord/redirect';
const OWO_SCOPE = 'identify guilds email guilds.members.read';

const DISCORD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0';

const discordOAuthUrl =
  'https://discord.com/api/oauth2/authorize?response_type=code&redirect_uri=https%3A%2F%2Fowobot.com%2Fapi%2Fauth%2Fdiscord%2Fredirect&scope=identify%20guilds%20email%20guilds.members.read&client_id=408785106942164992';

export type SolveOwoCaptchaResult = {
  success: boolean;
  message: string;
  url?: string;
};

const getDiscordAuthHeaders = (token: string, referer: string) => ({
  Authorization: token,
  'Content-Type': 'application/json',
  'User-Agent': DISCORD_USER_AGENT,
  Accept: '*/*',
  Origin: 'https://discord.com',
  Referer: referer,
});

const getOwoAuthCookie = async (token: string): Promise<string | null> => {
  try {
    const authRes = await axios.get('https://owobot.com/api/auth/discord', {
      maxRedirects: 0,
      validateStatus: (status) => status === 302 || status < 300,
    });

    const oauthUrl = authRes.headers.location;
    if (!oauthUrl) {
      console.error('[loginOwo] No OAuth redirect from owobot.com');
      return null;
    }

    await axios.get(oauthUrl, {
      headers: { 'User-Agent': DISCORD_USER_AGENT },
      validateStatus: () => true,
    });

    const oauthBody = {
      permissions: '0',
      authorize: true,
      integration_type: 0,
      location_context: {
        guild_id: '10000',
        channel_id: '10000',
        channel_type: 10000,
      },
    };

    const oauthRes = await axios.post(oauthUrl, oauthBody, {
      headers: getDiscordAuthHeaders(token, oauthUrl),
      params: {
        client_id: OWO_CLIENT_ID,
        response_type: 'code',
        redirect_uri: OWO_REDIRECT_URI,
        scope: OWO_SCOPE,
      },
      validateStatus: () => true,
    });

    if (oauthRes.status !== 200 || !oauthRes.data?.location) {
      console.error('[loginOwo] Discord OAuth failed:', oauthRes.data ?? oauthRes.status);
      return null;
    }

    const redirectRes = await axios.get(oauthRes.data.location, {
      maxRedirects: 0,
      validateStatus: (status) => status === 302 || status === 307 || status < 300,
      headers: {
        'User-Agent': DISCORD_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://discord.com/',
      },
    });

    const setCookie = redirectRes.headers['set-cookie'];
    if (!setCookie) {
      console.error('[loginOwo] No session cookie from OwO redirect');
      return null;
    }

    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ');
    return `_ga=GA1.2.509834688.1718790840; _gid=GA1.2.1642127289.1718790840; ${sessionCookie}`;
  } catch (error: any) {
    console.error('[loginOwo] Auth error:', error.response?.data ?? error.message);
    return null;
  }
};

const verifyOwoCaptcha = async (cookie: string, hcaptchaToken: string): Promise<boolean> => {
  try {
    const res = await axios.post(
      'https://owobot.com/api/captcha/verify',
      { token: hcaptchaToken },
      {
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'User-Agent': DISCORD_USER_AGENT,
        },
        validateStatus: () => true,
      }
    );

    if (res.status === 200) {
      console.log('[loginOwo] Captcha verified successfully');
      return true;
    }

    console.error('[loginOwo] Captcha verify failed:', res.data ?? res.status);
    return false;
  } catch (error: any) {
    console.error('[loginOwo] Verify error:', error.response?.data ?? error.message);
    return false;
  }
};

const getCaptchaSolveTimeoutMs = (): number => {
  const raw = process.env.CAPTCHA_SOLVE_TIMEOUT?.trim();
  const parsed = raw ? Number(raw) : 90;
  if (!Number.isFinite(parsed) || parsed <= 0) return 90_000;
  return parsed * 1000;
};

const FALLBACK_CAPTCHA_URL = 'https://owobot.com/captcha';

export const getOwoCaptchaUrl = async (token: string): Promise<string> => {
  try {
    return (await getOwoUrlLogin(token)) || FALLBACK_CAPTCHA_URL;
  } catch {
    return FALLBACK_CAPTCHA_URL;
  }
};

export const solveOwoCaptcha = async (token: string): Promise<SolveOwoCaptchaResult> => {
  try {
    const apiKey = process.env.CAPTCHA_API_KEY?.trim();
    const service = process.env.CAPTCHA_SERVICE?.trim() ?? 'capsolver';
    const solveTimeoutMs = getCaptchaSolveTimeoutMs();
    const manualUrl = await getOwoCaptchaUrl(token);

    if (!apiKey) {
      return {
        success: false,
        message: 'CAPTCHA_API_KEY not set — solve manually in browser',
        url: manualUrl,
      };
    }

    console.log(`[loginOwo] Starting automatic captcha solve (timeout ${Math.round(solveTimeoutMs / 1000)}s)...`);

    const cookie = await getOwoAuthCookie(token);
    if (!cookie) {
      return {
        success: false,
        message: 'Failed to authenticate with OwO (OAuth cookie)',
        url: manualUrl,
      };
    }

    const hcaptchaToken = await solveHcaptcha(apiKey, service, solveTimeoutMs);
    if (!hcaptchaToken) {
      return {
        success: false,
        message: `hCaptcha solve failed (${service}) — solve manually in browser`,
        url: manualUrl,
      };
    }

    const verified = await verifyOwoCaptcha(cookie, hcaptchaToken);
    if (!verified) {
      return {
        success: false,
        message: 'OwO rejected captcha token — solve manually in browser',
        url: manualUrl,
      };
    }

    return { success: true, message: 'Captcha solved and verified' };
  } catch (error: any) {
    const status = error.response?.status;
    const detail =
      status === 401 ? 'unauthorized — check TOKEN or CAPTCHA_API_KEY' : (error.message ?? 'unknown error');
    console.error('[loginOwo] Captcha solve error:', error.response?.data ?? detail);
    return {
      success: false,
      message: `Captcha solve error (${detail}) — solve manually in browser`,
      url: FALLBACK_CAPTCHA_URL,
    };
  }
};

const getOwoUrlLogin = async (token: string): Promise<string | undefined> => {
  const headers = {
    Authorization: token,
    'Content-Type': 'application/json',
  };

  const body = {
    guild_id: '1119963281923248219',
    permissions: '8',
    authorize: true,
    integration_type: 0,
    location_context: {
      guild_id: '10000',
      channel_id: '10000',
      channel_type: 10000,
    },
  };

  try {
    const response = await axios.post(discordOAuthUrl, body, {
      headers,
      validateStatus: () => true,
    });

    if (response.status === 401) {
      console.error('[loginOwo] Discord OAuth unauthorized — check TOKEN in .env');
      return undefined;
    }

    if (response.status !== 200 || !response.data?.location) {
      console.error('[loginOwo] OAuth URL error:', response.status, response.data);
      return undefined;
    }

    return response.data.location;
  } catch (error: any) {
    console.error('[loginOwo] OAuth URL error:', error.response?.data ?? error.message);
    return undefined;
  }
};

export default getOwoUrlLogin;
export { getOwoUrlLogin, getOwoAuthCookie };
