import {
  openPipedreamConnectUI,
  type PipedreamConnectEvent,
  type PipedreamConnectUI,
} from '@core/pipedream/connect-ui';
import { assignOauthUrl, reserveOauthPopup } from '@core/pipedream/oauth-popup';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isTauri } from '@core/util/platform';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  Connector,
  ConnectStep,
} from '@service-cognition/generated/schemas';
import { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { invalidateConnectors, upsertConnector } from './connectors';

/**
 * `connected` once the connection exists (every reader's list already holds
 * it); `closed` when the user left the flow without finishing.
 */
export type ConnectOutcome = 'connected' | 'closed';

type ConnectArgs = {
  /** The connector key: `app/{slug}` from the catalog, or one the server gave. */
  key: string;
  /**
   * Where an embedded connect dialog mounts; `document.body` by default. A
   * surface inside a modal passes the modal's content so the dialog stays
   * usable under its focus trap.
   */
  container?: HTMLElement;
};

/** How often a connect page that cannot report back is checked on. */
const COMPLETE_POLL_MS = 2000;
// Matches the server's pending-connection lifetime.
const COMPLETE_TIMEOUT_MS = 10 * 60 * 1000;
/** How long a dialog that reported success may take to show the connection. */
const CONFIRM_ATTEMPTS = 5;
/** Polls left once the tab has closed, if the one that would see it failed. */
const CLOSED_RETRIES = 3;

function currentUserId() {
  return queryClient.getQueryData<UserInfoData>(authKeys.userInfo.queryKey)?.id;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Connect an app, or sign in to a server added by URL: ask the server how,
 * do what it answers, then have it record the connection.
 *
 * The server answers with a page to open (consent in a popup on the web, the
 * system browser in the native apps; its completion is polled, because the
 * page cannot message this tab) or an embedded dialog with a short-lived
 * token (Pipedream's Connect UI, in an iframe on the web and the system
 * browser in the native apps). The web never chooses between them, for
 * GitHub either: when GitHub's connection is the account link, the page the
 * server answers with is the app's own `/app/connect/github`, which starts it.
 *
 * Rejects when the server refuses or the connection fails.
 */
export async function connectConnector(
  args: ConnectArgs
): Promise<ConnectOutcome> {
  // The server may answer with a page to open, which Safari only allows from
  // a tab opened inside the click: reserve one now (none in the native apps),
  // and close it again unless the answer needs it.
  const popup = reserveOauthPopup();
  return await Telemetry.span('connector.connect', async (span) => {
    // An app's slug is public catalog data; a server's key holds its URL.
    span.setAttr('connector.kind', args.key.split('/')[0] ?? '');
    if (args.key.startsWith('app/'))
      span.setAttr('connector.app_slug', args.key.slice('app/'.length));
    span.setAttr('connector.native', isTauri());
    try {
      const userId = currentUserId();
      const step = await span.span(
        'connector.start',
        async () =>
          await throwOnErr(
            async () =>
              await cognitionApiServiceClient.startConnectorConnect({
                key: args.key,
              })
          )
      );
      if (currentUserId() !== userId) {
        popup?.close();
        return 'closed';
      }
      const outcome = await followStep(args, step, popup, span, userId);
      span.setAttr('connector.outcome', outcome);
      return outcome;
    } catch (error) {
      popup?.close();
      // Do not copy third-party errors or consent URLs into telemetry.
      span.error('Connector connection failed');
      throw error;
    }
  });
}

async function followStep(
  args: ConnectArgs,
  step: ConnectStep,
  popup: Window | null,
  span: Span,
  userId: string | undefined
): Promise<ConnectOutcome> {
  return await match(step)
    .with({ type: 'openUrl' }, async (page) => {
      span.setAttr('connector.step', 'openUrl');
      // Without a reserved tab (native apps, or a blocked popup) the page
      // opens in the system browser or a new window.
      assignOauthUrl(popup, page.url);
      return await span.span(
        'connector.consent',
        async () => await pollCompletion(args.key, popup, userId)
      );
    })
    .with({ type: 'embeddedDialog' }, async (dialog) => {
      span.setAttr('connector.step', 'embeddedDialog');
      popup?.close();
      return await connectInDialog(args, dialog, span, userId);
    })
    .exhaustive(() => {
      throw new Error('The server answered with an unknown connect step');
    });
}

/**
 * Ask the server to record the connection until it exists, the consent tab
 * is closed, the session expires, or another user signs in. Setup can take
 * minutes and hundreds of polls, so a failed poll doesn't end it; only the
 * last answer counts.
 */
async function pollCompletion(
  key: string,
  tab: Window | null,
  userId: string | undefined
): Promise<ConnectOutcome> {
  const deadline = Date.now() + COMPLETE_TIMEOUT_MS;
  let closedRetries = CLOSED_RETRIES;
  let failure: ConstructorParameters<typeof ThrownResultError>[0] | undefined;
  while (Date.now() < deadline && currentUserId() === userId) {
    const closed = tab?.closed ?? false;
    const result = await cognitionApiServiceClient.completeConnectorConnect({
      key,
    });
    if (result.isOk()) {
      if (currentUserId() !== userId) return 'closed';
      finishTab(tab, 'connected');
      return await recordConnected(result.value);
    }
    failure = result.error.some((error) => error.code === 'NOT_FOUND')
      ? undefined
      : result.error;
    if (closed && (!failure || closedRetries-- <= 0)) break;
    await sleep(COMPLETE_POLL_MS);
  }
  finishTab(tab, 'error');
  if (failure && currentUserId() === userId)
    throw new ThrownResultError(failure);
  return 'closed';
}

/**
 * Take the consent tab off the vendor's page. `close()` does nothing once a
 * tab with a severed opener has navigated, so send it to the page that closes
 * itself or tells the user to.
 */
function finishTab(tab: Window | null, status: 'connected' | 'error') {
  if (tab && !tab.closed) {
    tab.location.href = `${SERVER_HOSTS['cognition-service']}/pipedream/mcp/connect/callback?status=${status}`;
  }
}

/** The recorded connector, or none while the server has nothing to record. */
async function completeOnce(key: string): Promise<Connector | undefined> {
  const result = await cognitionApiServiceClient.completeConnectorConnect({
    key,
  });
  if (result.isOk()) return result.value;
  if (result.error.some((error) => error.code === 'NOT_FOUND')) return;
  throw new ThrownResultError(result.error);
}

async function recordConnected(connector: Connector): Promise<ConnectOutcome> {
  upsertConnector(connector);
  await invalidateConnectors();
  if (connector.status !== 'connected')
    throw new Error('The connection was recorded but is not usable');
  return 'connected';
}

const parseUrl = Result.fromThrowable(
  (link: string) => new URL(link),
  () => ({ kind: 'invalid-url' as const })
);

type DialogResult = Exclude<PipedreamConnectEvent, { type: 'error' }>;

/** The app the dialog's own link names (a vendor slug), else the key's slug. */
function dialogApp(key: string, link: string): string {
  const parsed = parseUrl(link);
  const fromLink = parsed.isOk() ? parsed.value.searchParams.get('app') : null;
  return fromLink ?? key.slice(key.indexOf('/') + 1);
}

/**
 * Run the embedded connect dialog with the server's token. A dialog can close
 * without reporting success although the account was made (an OAuth provider
 * severs its consent popup's opener), so a close also asks the server once.
 */
async function connectInDialog(
  args: ConnectArgs,
  dialog: Extract<ConnectStep, { type: 'embeddedDialog' }>,
  span: Span,
  userId: string | undefined
): Promise<ConnectOutcome> {
  const openDialog = isTauri()
    ? (await import('@core/pipedream/connect-native'))
        .openNativePipedreamConnectUI
    : openPipedreamConnectUI;
  if (currentUserId() !== userId) return 'closed';
  let ui: PipedreamConnectUI | undefined;
  const result = await span.span(
    'connector.dialog',
    async () =>
      await new Promise<DialogResult>((resolve) => {
        ui = openDialog({
          token: dialog.token,
          app: dialogApp(args.key, dialog.link),
          container: args.container,
          // 'error' events are shown inside the dialog itself; the user can
          // retry there or close, so they don't settle the flow.
          onEvent: (event) => {
            if (event.type !== 'error') resolve(event);
          },
        });
      })
  );
  try {
    if (currentUserId() !== userId) return 'closed';
    span.setAttr('connector.dialog_result', result.type);
    const connector =
      result.type === 'success'
        ? await confirmConnection(args.key)
        : await completeOnce(args.key);
    if (!connector || currentUserId() !== userId) return 'closed';
    return await recordConnected(connector);
  } finally {
    ui?.close();
  }
}

/** After the dialog reports success, wait briefly for the server to see it. */
async function confirmConnection(key: string): Promise<Connector | undefined> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
    const connector = await completeOnce(key);
    if (connector) return connector;
    await sleep(COMPLETE_POLL_MS);
  }
  return undefined;
}
