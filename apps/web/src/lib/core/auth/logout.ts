import { clearMcpAuthAttempts } from '@app/features/settings/mcp-auth-attempt';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { syncLoginStorage } from '@core/util/cookies';
import { clearPostLoginRedirect } from '@core/util/postLoginRedirect';
import { clearRegisteredCaches } from '@graphql-cache/lifecycle';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import {
  clearLocalDrafts,
  flushLocalDrafts,
  listLocalDrafts,
} from '@queries/email/local-drafts';
import { notificationKeys } from '@queries/notification/keys';
import { propertiesKeys } from '@queries/properties/keys';
import { resetGraphqlSoupDoneSession } from '@queries/soup/graphql/done-session';
import { clearDocumentQueryCache } from '@queries/storage/document-cache';
import { clearOfflineDocumentContexts } from '@queries/storage/documentLoad/offline-context-runtime';
import { authServiceClient } from '@service-auth/client';
import { raceTimeout } from '@solid-primitives/promise';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { confirmDialog } from '@ui';
import { getOwner } from 'solid-js';
import { unregisterPushRegistrationsForLogout } from './push-registration-lifecycle';

const unauthenticatedUserInfo: UserInfoData = {
  id: '',
  permissions: [],
  email: '',
  name: null,
  licenseStatus: 'inactive',
  tutorialComplete: false,
  group: null,
  hasChromeExt: false,
  authenticated: false,
  userId: '',
  hasTrialed: false,
  aiDataConsent: false,
  referralCode: '',
  createdAt: undefined,
};

export async function clearLocalAuthSession() {
  document.cookie =
    'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
  syncLoginStorage(false);
  const documentContextsCleared = clearOfflineDocumentContexts();
  clearDocumentQueryCache(queryClient);
  queryClient.setQueryData(authKeys.userInfo.queryKey, unauthenticatedUserInfo);
  queryClient.removeQueries({ queryKey: emailKeys.links.queryKey });
  queryClient.removeQueries({ queryKey: notificationKeys._def });
  resetGraphqlSoupDoneSession();
  queryClient.removeQueries({ queryKey: propertiesKeys._def });
  // The billing position (usage, credits, overage settings) belongs to the
  // account that fetched it; never let it render for the next sign-in.
  queryClient.removeQueries({ queryKey: authKeys.aiBillingSummary.queryKey });

  // Queued mutations are user intent; never allow them to replay under a
  // subsequent account sharing this anonymous device cache scope.
  await Promise.all([
    documentContextsCleared,
    clearRegisteredCaches(),
    clearLocalDrafts(),
  ]);
  clearMcpAuthAttempts();
}

export function useLogout() {
  const analytics = useAnalytics();
  const navigate = useNavigate();
  const owner = getOwner();

  return createCallback(async () => {
    let warning: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const inspectDrafts = async () => {
        await flushLocalDrafts();
        return await listLocalDrafts();
      };
      const drafts = await Promise.race([
        inspectDrafts(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Draft storage timed out')),
            3000
          );
        }),
      ]);
      const unsynced = drafts.filter((draft) => draft.status !== 'synced');
      if (unsynced.length)
        warning = `${unsynced.length} draft(s) have changes saved only on this device. Signing out removes those changes and their pending attachments.`;
    } catch {
      warning =
        'Draft storage could not be checked. Signing out removes drafts and attachments saved only on this device, including any changes that have not synced.';
    } finally {
      clearTimeout(timer);
    }
    if (
      warning &&
      !(await confirmDialog(
        {
          title: 'Sign out and remove local drafts?',
          body: warning,
          confirmLabel: 'Sign out',
        },
        { owner }
      ))
    )
      return;
    clearPostLoginRedirect();
    // Must run before the session is torn down — the unregister call is
    // authenticated. Time-boxed so a hung request can't block logout.
    await raceTimeout(unregisterPushRegistrationsForLogout(), 3000);
    await clearLocalAuthSession();
    await authServiceClient.logout();
    analytics.track('sign_out');
    analytics.reset();

    if (isNativeMobilePlatform()) {
      await fetch(SERVER_HOSTS['auth-logout'], {
        credentials: 'include',
        mode: 'no-cors',
        redirect: 'manual',
      }).catch(() => {});
      navigate('/login');
      // Native login reuses this WebView. End the document lifetime so queued
      // editor callbacks can never adopt the next account's draft session.
      window.location.reload();
    } else {
      window.location.href = SERVER_HOSTS['auth-logout'];
    }
  });
}
