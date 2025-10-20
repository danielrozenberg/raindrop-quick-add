import {
  REFRESH_ACCESS_TOKEN_ALARM,
  requestNewAccessToken,
  requestRefreshAccessToken,
  scheduleAccessTokenRefresh,
} from './background/access-token';
import { addBookmark, removeBookmark } from './background/bookmarks';
import {
  checkIfBookmarked,
  setPageActionNotAuthorized,
} from './background/page-actions';
import { getAccessTokenFromStorage } from './common/access-token';
import { AUTHORIZATION_URL } from './common/constants';
import { ALL_HOST_PERMISSION } from './common/host-permission';
import { PageState, clearPageState, getPageState } from './common/page-state';

import type { Browser, Runtime } from 'webextension-polyfill';

declare const browser: Browser;

browser.runtime.onInstalled.addListener(async () => {
  console.debug('Extension installed or updated');
  // Ensure the extension has the necessary permissions and is authenticated
  // with Raindrop. If not, redirect the user to the welcome page.
  const accessToken = await getAccessTokenFromStorage();
  if (
    !(await browser.permissions.contains(ALL_HOST_PERMISSION)) ||
    !accessToken
  ) {
    await browser.tabs.create({
      active: true,
      url: browser.runtime.getURL('welcome.html'),
    });
    return;
  }

  await scheduleAccessTokenRefresh(accessToken.expiresAt);
});

browser.runtime.onStartup.addListener(async () => {
  console.debug('Extension started');
  // Check if there is an access token stored for the extension, and if it is
  // expired. Reauthenticate if necessary.
  const accessToken = await getAccessTokenFromStorage();
  if (!accessToken) {
    return;
  }

  await scheduleAccessTokenRefresh(accessToken.expiresAt);
});

browser.runtime.onMessage.addListener(
  async (_message: unknown, sender: Runtime.MessageSender) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      console.warn('Received message without a sender tab ID', {
        _message,
        sender,
      });
      return;
    }

    const message = _message as Payload;
    switch (message.action) {
      case 'start-authentication':
        console.debug('Starting authentication', { tabId, code: message.code });
        await browser.tabs.remove(tabId);
        return requestNewAccessToken(message.code);

      case 'set-page-action-not-authorized':
        console.debug('Setting page action to not authorized', { tabId });
        return setPageActionNotAuthorized(tabId);

      default:
        console.warn('Received unknown message:', message);
    }
  },
);

browser.alarms.onAlarm.addListener(async (alarm) => {
  console.debug('Alarm received', { alarm });
  if (alarm.name !== REFRESH_ACCESS_TOKEN_ALARM) {
    console.warn('Received unexpected alarm:', alarm);
    return;
  }

  const accessToken = await getAccessTokenFromStorage();
  if (!accessToken) {
    console.warn('No access token found for refresh alarm');
    return;
  }

  await requestRefreshAccessToken(accessToken.refreshToken);
});

browser.pageAction.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    console.warn('Page action clicked without a tab ID');
    return;
  }

  const pageStateInfo = await getPageState(tab.id);
  switch (pageStateInfo?.state) {
    case PageState.NotAuthorized:
      await browser.tabs.create({
        active: true,
        url: AUTHORIZATION_URL,
      });
      break;

    case PageState.Pending:
      console.log('Page action clicked while pending');
      break;

    case PageState.AddBookmark:
      console.log('Page action clicked to add bookmark');
      await addBookmark(tab.id, pageStateInfo.url, tab.title);
      break;

    case PageState.RemoveBookmark:
      console.log('Page action clicked to remove bookmark');
      await removeBookmark(
        tab.id,
        pageStateInfo.url,
        pageStateInfo.bookmarkId,
        tab.title,
      );
      break;

    default:
      console.warn('Unknown page state:', pageStateInfo?.state);
      return;
  }
});

browser.menus.onClicked.addListener(async (info) => {
  switch (info.menuItemId) {
    case 'options':
      await browser.runtime.openOptionsPage();
      break;

    default:
      console.warn('Unknown context menu item clicked:', info.menuItemId);
  }
});

browser.tabs.onUpdated.addListener(
  async (tabId, changeInfo) => {
    const { url, title } = changeInfo;
    if (!url?.match(/^https?:\/\//)) {
      return;
    }

    await checkIfBookmarked(tabId, url, title);
  },
  { properties: ['url'] },
);

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const { url, title } = await browser.tabs.get(tabId);
  if (!url?.match(/^https?:\/\//)) {
    return;
  }

  const pageState = await getPageState(tabId);
  if (!pageState) {
    await checkIfBookmarked(tabId, url, title);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await clearPageState(tabId);
});

browser.menus.create({
  id: 'options',
  title: browser.i18n.getMessage('menuOptions'),
  contexts: ['page_action'],
});
