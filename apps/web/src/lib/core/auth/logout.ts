import { clearMcpAuthAttempts } from '@app/features/settings/mcp-auth-attempt';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { clearNativeDiagnostics } from '@app/observability/native-diagnostics';
import { reloadApp } from '@app/observability/reload';
import { SERVER_HOSTS } from '@core/constant/servers';
import { clearPipedreamCallbacks } from '@core/pipedream/connect-callback';
import { syncLoginStorage } from '@core/util/cookies';
import { isTauri } from '@core/util/platform';
import { clearPostLoginRedirect } from '@core/util/postLoginRedirect';
import { clearRegisteredCaches } from '@graphql-cache/lifecycle';
import { rotateCacheScope } from '@graphql-cache/scope';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { clearTeamCalendarQueries } from '@queries/calendar/team-cache';
import { queryClient, queryPersistence } from '@queries/client';
import {
  clearLocalDrafts,
  flushLocalDrafts,
  listLocalDrafts,
} from '@queries/email/local-drafts';
import { setEmailOutboxSession } from '@queries/email/outbox-session';
import {
  readEmailSendIntents,
  settledSendAttempt,
} from '@queries/email/send-queue';
import { resetGraphqlSoupDoneSession } from '@queries/soup/graphql/done-session';
import { clearDocumentQueryCache } from '@queries/storage/document-cache';
import { clearOfflineDocumentContexts } from '@queries/storage/documentLoad/offline-context-runtime';
import { authServiceClient } from '@service-auth/client';
import {
  recordGraphqlMutationQueueCleared,
  setGraphqlSoupSessionActive,
} from '@service-storage/graphql-soup';
import { raceTimeout } from '@solid-primitives/promise';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { confirmDialog } from '@ui';
import { getOwner } from 'solid-js';
import { clearComposerStorage } from './clear-composer-storage';
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

export async function clearLocalAuthSession(
  cause: 'logout' | 'session-expired' = 'logout'
) {
  await clearNativeDiagnostics();
  clearPipedreamCallbacks();
  document.cookie =
    'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
  setEmailOutboxSession(undefined);
  syncLoginStorage(false);
  const documentContextsCleared = clearOfflineDocumentContexts();
  clearDocumentQueryCache(queryClient);
  clearTeamCalendarQueries();
  // Start every wipe before waiting, including stores not hydrated this session.
  const results = await Promise.allSettled([
    // Reads the queue before the cache wipe below deletes it.
    recordGraphqlMutationQueueCleared(cause),
    Promise.resolve().then(clearComposerStorage),
    documentContextsCleared,
    clearRegisteredCaches(),
    queryPersistence.clear(),
    clearLocalDrafts(),
  ]);
  if (results.some((result) => result.status === 'rejected')) {
    await rotateCacheScope();
  }
  // Only after the wipes: clearing the cache needs its registered host.
  setGraphqlSoupSessionActive(false);
  resetGraphqlSoupDoneSession();
  queryClient.setQueryData(authKeys.userInfo.queryKey, unauthenticatedUserInfo);
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
        const [drafts, sends] = await Promise.all([
          listLocalDrafts(),
          readEmailSendIntents(),
        ]);
        return { drafts, sends };
      };
      const { drafts, sends } = await Promise.race([
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
      if (sends.some((send) => settledSendAttempt(send)?.status !== 'SENT'))
        warning = [
          warning,
          'Pending sends remain saved for this account and resume when you sign in again. Sends already accepted by the server may still be delivered; signing out does not cancel them.',
        ]
          .filter(Boolean)
          .join(' ');
    } catch {
      warning =
        'Draft storage could not be checked. Signing out removes unsubmitted drafts and their pending attachments. Approved sends stay saved for this account; sends already accepted by the server may still be delivered.';
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

    // The Tauri shell (desktop and mobile alike) can never navigate to the
    // identity provider: its navigation plugin treats any off-origin URL as
    // external and hands it to the system browser, which leaves the webview
    // sitting on the signed-in screen. End the provider session with a
    // background request instead and route the webview to /login in place.
    if (isTauri()) {
      await fetch(SERVER_HOSTS['auth-logout'], {
        credentials: 'include',
        mode: 'no-cors',
        redirect: 'manual',
      }).catch(() => {});
      navigate('/login');
      // Native login reuses this WebView. End the document lifetime so queued
      // editor callbacks can never adopt the next account's draft session.
      reloadApp('logout');
    } else {
      window.location.href = SERVER_HOSTS['auth-logout'];
    }
  });
}
