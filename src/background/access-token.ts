import { CLIENT_ID, CLIENT_SECRET, REDIRECT_URL } from '../common/constants';
import { apiAccessToken } from './api';

import type { Browser } from 'webextension-polyfill';
import type { AccessToken } from '../common/storage';

declare const browser: Browser;

const REAUTHENTICATION_BUFFER = 24 * 60 * 60 * 1000; // 24 hours
export const REFRESH_ACCESS_TOKEN_ALARM = 'refreshAccessToken';

export async function requestNewAccessToken(code: string): Promise<void> {
  const success = await fetchAndStoreAccessToken({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URL,
  });
  if (!success) {
    await browser.tabs.create({
      active: true,
      url: browser.runtime.getURL('authentication-error.html'),
    });
  }
}
export async function requestRefreshAccessToken(
  refreshToken: string,
): Promise<void> {
  const success = await fetchAndStoreAccessToken({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  if (!success) {
    console.warn('Failed to refresh access token');
  }
}

async function fetchAndStoreAccessToken(
  request: Parameters<typeof apiAccessToken>[0],
): Promise<boolean> {
  try {
    const response = await apiAccessToken(request);
    const accessToken: AccessToken = {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
    };
    await browser.storage.sync.set({ accessToken });
    await scheduleAccessTokenRefresh(accessToken.expiresAt);
    return true;
  } catch (error) {
    console.error('Error fetching access token:', error);
    await browser.storage.sync.remove('accessToken');
    return false;
  }
}

export async function scheduleAccessTokenRefresh(
  expiresAt: number,
): Promise<void> {
  await browser.alarms.create(REFRESH_ACCESS_TOKEN_ALARM, {
    when: expiresAt - REAUTHENTICATION_BUFFER,
  });
}
