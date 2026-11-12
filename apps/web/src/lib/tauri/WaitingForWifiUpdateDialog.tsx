import { t } from '@app/lib/i18n';
import { makePersistedState } from '@app/lib/persistence';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';
import { Button, Dialog, Surface } from '@ui';
import { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { BundleUpdateStatus } from './TauriProvider';

/** Device-wide: the update waiting for Wi-Fi belongs to the install. */
const SNOOZE_STORAGE_KEY = 'macro:bundle-update:wifi-offer-snoozed-until';
/** How long "Not now" holds off the offer, across relaunches. */
export const WIFI_OFFER_SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZED_UNTIL_SCHEMA = z.coerce.number().int().nonnegative();

export const WAITING_FOR_WIFI_PHASES = [
  'closed',
  'offer',
  'downloading',
  'ready',
  'failed',
] as const;

export type WaitingForWifiPromptPhase =
  (typeof WAITING_FOR_WIFI_PHASES)[number];

export type WaitingForWifiPrompt = ReturnType<
  typeof createWaitingForWifiPrompt
>;

/**
 * Where the prompt goes when the bundle updater reports `status`.
 *
 * The offer opens when the updater waits for Wi-Fi and `mayOffer` allows it,
 * and closes if that wait ends some other way (Wi-Fi arrived and the download
 * started on its own). After the person approves, the prompt follows the
 * download to `ready` or `failed`; the updater passes through `Idle` and
 * `CheckingForUpdate` when a resume restarts its check, so those keep it open,
 * and a download that starts after a failure is followed again. A required
 * native update or a revoked bundle closes it from any phase, because the
 * App Store prompt takes over and no downloaded bundle can apply.
 */
export function nextWaitingForWifiPromptPhase(
  phase: WaitingForWifiPromptPhase,
  status: BundleUpdateStatus,
  mayOffer: boolean
): WaitingForWifiPromptPhase {
  if (
    status.status === 'NativeUpdateRequired' ||
    status.status === 'ClearRequired'
  ) {
    return 'closed';
  }
  return match(phase)
    .with('closed', () =>
      status.status === 'WaitingForWifi' && mayOffer ? 'offer' : phase
    )
    .with('offer', () =>
      status.status === 'WaitingForWifi' ? phase : 'closed'
    )
    .with('downloading', () =>
      match(status.status)
        .returnType<WaitingForWifiPromptPhase>()
        .with('Completed', () => 'ready')
        .with('Error', () => 'failed')
        .with('NoUpdateNeeded', () => 'closed')
        .with(
          'Idle',
          'CheckingForUpdate',
          'UpdateFound',
          'WaitingForWifi',
          'Downloading',
          'Unzipping',
          () => phase
        )
        // The native updater ships separately and may add statuses.
        .exhaustive(() => phase)
    )
    .with('failed', () =>
      // A refused grant can race a download that Wi-Fi started; follow it.
      match(status.status)
        .returnType<WaitingForWifiPromptPhase>()
        .with('Downloading', 'Unzipping', () => 'downloading')
        .with('Completed', () => 'ready')
        .otherwise(() => phase)
    )
    .with('ready', () => phase)
    .exhaustive();
}

/**
 * Offers to download a bundle update that is waiting for Wi-Fi.
 *
 * Mobile builds download bundle updates only on Wi-Fi or Ethernet, so someone
 * on cellular, or behind a VPN the OS doesn't report as Wi-Fi, stays on their
 * current bundle until they join one, even when that bundle is broken. The
 * offer opens at most once per page load. Declining it leaves the native
 * Wi-Fi wait running and holds off the offer for a day, across relaunches;
 * approving it starts the download over the current connection.
 *
 * Feed it every status the updater reports with `observe`, and call
 * `yieldToNativeUpdate` when the App Store prompt opens.
 */
export function createWaitingForWifiPrompt(
  status: Accessor<BundleUpdateStatus>
) {
  const [phase, setPhase] = createSignal<WaitingForWifiPromptPhase>('closed');
  const [snoozedUntil, setSnoozedUntil] = createSnooze();
  let canOffer = true;

  const mayOffer = () => canOffer && (snoozedUntil() ?? 0) <= Date.now();

  function observe(next: BundleUpdateStatus) {
    const nextPhase = nextWaitingForWifiPromptPhase(phase(), next, mayOffer());
    if (nextPhase === 'offer') canOffer = false;
    setPhase(nextPhase);
  }

  /** Hide the prompt; turning down the offer also snoozes it. */
  function close() {
    if (phase() === 'offer') setSnoozedUntil(Date.now() + WIFI_OFFER_SNOOZE_MS);
    setPhase('closed');
  }

  /**
   * The app needs a newer native build: that prompt wins, and a bundle
   * download can't help, so close this one and stop offering for this page.
   */
  function yieldToNativeUpdate() {
    canOffer = false;
    setPhase('closed');
  }

  async function download() {
    setPhase('downloading');
    const granted = await ResultAsync.fromPromise(
      invoke('grant_bundle_update', { approved: true }),
      (error: unknown) => error
    );
    if (granted.isOk()) return;
    Telemetry.error(granted.error, { surface: 'bundle-update' });
    // A download that started on its own (Wi-Fi arrived) also rejects the
    // grant; only a wait that is still pending means nothing will happen.
    if (status().status === 'WaitingForWifi') setPhase('failed');
  }

  async function restart() {
    const applied = await ResultAsync.fromPromise(
      invoke<boolean>('perform_update'),
      (error: unknown) => error
    );
    if (applied.isErr()) {
      Telemetry.error(applied.error, { surface: 'bundle-update' });
    }
    // The webview reloads when the update applies; anything else (a reload
    // hold, or the update already applied) leaves nothing to wait for.
    close();
  }

  return { phase, observe, close, yieldToNativeUpdate, download, restart };
}

function createSnooze() {
  return makePersistedState(createSignal<number | undefined>(), {
    storages: {
      restore: () => {
        try {
          const stored = localStorage.getItem(SNOOZE_STORAGE_KEY);
          if (stored === null) return undefined;
          const parsed = SNOOZED_UNTIL_SCHEMA.safeParse(stored);
          return parsed.success ? parsed.data : undefined;
        } catch {
          return undefined;
        }
      },
      write: (value) => {
        try {
          if (value === undefined) localStorage.removeItem(SNOOZE_STORAGE_KEY);
          else localStorage.setItem(SNOOZE_STORAGE_KEY, String(value));
        } catch {
          // Storage may be unavailable; the offer then waits for a relaunch.
        }
      },
    },
  });
}

function downloadProgress(status: BundleUpdateStatus): string {
  if (status.status === 'Downloading') {
    return t('mobile.updateDownloadProgress', {
      progress: Math.round(status.data.progress),
    });
  }
  if (status.status === 'Unzipping') {
    return t('mobile.updateInstallProgress', {
      progress: Math.round(status.data.progress),
    });
  }
  return t('mobile.updateStartingDownload');
}

export function WaitingForWifiUpdateDialog(props: {
  prompt: WaitingForWifiPrompt;
  status: BundleUpdateStatus;
}) {
  const runDownload = () =>
    fireAndForget(props.prompt.download(), 'bundle-update');
  const runRestart = () =>
    fireAndForget(props.prompt.restart(), 'bundle-update');
  // Keep the last content while the sheet animates closed.
  const shown = createMemo<WaitingForWifiPromptPhase>((last) => {
    const phase = props.prompt.phase();
    return phase === 'closed' ? last : phase;
  }, 'offer');

  return (
    <Dialog
      open={props.prompt.phase() !== 'closed'}
      onOpenChange={(open) => {
        if (!open) props.prompt.close();
      }}
      class="w-[90%] max-w-120"
      position="center"
    >
      <Surface depth={2}>
        <div class="flex flex-col gap-4 px-4 py-5">
          <Switch>
            <Match when={shown() === 'offer'}>
              <PromptBody
                title={t('mobile.updateOffWifiTitle')}
                description={t('mobile.updateOffWifiDescription')}
              />
              <PromptActions>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.prompt.close}
                >
                  {t('mobile.updateNotNow')}
                </Button>
                <Button variant="primary" size="sm" onClick={runDownload}>
                  {t('mobile.updateDownload')}
                </Button>
              </PromptActions>
            </Match>
            <Match when={shown() === 'downloading'}>
              <PromptBody
                title={t('mobile.updateDownloadingTitle')}
                description={downloadProgress(props.status)}
              />
              <PromptActions>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.prompt.close}
                >
                  {t('mobile.updateHide')}
                </Button>
              </PromptActions>
            </Match>
            <Match when={shown() === 'ready'}>
              <PromptBody
                title={t('mobile.updateReadyTitle')}
                description={t('mobile.updateReadyDescription')}
              />
              <PromptActions>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.prompt.close}
                >
                  {t('mobile.updateLater')}
                </Button>
                <Button variant="primary" size="sm" onClick={runRestart}>
                  {t('mobile.updateRestart')}
                </Button>
              </PromptActions>
            </Match>
            <Match when={shown() === 'failed'}>
              <PromptBody
                title={t('mobile.updateFailedTitle')}
                description={t('mobile.updateFailedDescription')}
              />
              <PromptActions>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.prompt.close}
                >
                  {t('mobile.updateOk')}
                </Button>
              </PromptActions>
            </Match>
          </Switch>
        </div>
      </Surface>
    </Dialog>
  );
}

function PromptBody(props: { title: string; description: string }) {
  return (
    <div class="flex flex-col gap-2">
      <Dialog.Title class="text-lg font-semibold text-ink">
        {props.title}
      </Dialog.Title>
      <Dialog.Description class="text-sm leading-5 text-ink-extra-muted">
        {props.description}
      </Dialog.Description>
    </div>
  );
}

function PromptActions(props: { children: JSX.Element }) {
  return <div class="flex justify-end gap-2">{props.children}</div>;
}
