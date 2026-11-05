import { t } from '@app/lib/i18n';
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
import type { BundleUpdateStatus } from './TauriProvider';

export type WaitingForWifiPromptPhase =
  | 'closed'
  | 'offer'
  | 'downloading'
  | 'ready'
  | 'failed';

export type WaitingForWifiPrompt = ReturnType<
  typeof createWaitingForWifiPrompt
>;

/**
 * Where the prompt goes when the bundle updater reports `status`.
 *
 * The offer opens the first time the updater waits for Wi-Fi and closes if
 * that wait ends some other way (Wi-Fi arrived and the download started on
 * its own). After the person approves, the prompt follows the download to
 * `ready` or `failed`; the updater passes through `Idle` and
 * `CheckingForUpdate` when a resume restarts its check, so those keep it open,
 * and a download that starts after a failure is followed again.
 */
export function nextWaitingForWifiPromptPhase(
  phase: WaitingForWifiPromptPhase,
  status: BundleUpdateStatus,
  offered: boolean
): WaitingForWifiPromptPhase {
  return match(phase)
    .with('closed', () =>
      status.status === 'WaitingForWifi' && !offered ? 'offer' : phase
    )
    .with('offer', () =>
      status.status === 'WaitingForWifi' ? phase : 'closed'
    )
    .with('downloading', () =>
      match(status.status)
        .returnType<WaitingForWifiPromptPhase>()
        .with('Completed', () => 'ready')
        .with('Error', () => 'failed')
        .with(
          'NoUpdateNeeded',
          'ClearRequired',
          'NativeUpdateRequired',
          () => 'closed'
        )
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
 * offer opens once per page load. Closing it leaves the native Wi-Fi wait
 * running; approving it starts the download over the current connection.
 *
 * Feed it every status the updater reports with `observe`.
 */
export function createWaitingForWifiPrompt(
  status: Accessor<BundleUpdateStatus>
) {
  const [phase, setPhase] = createSignal<WaitingForWifiPromptPhase>('closed');
  let offered = false;

  function observe(next: BundleUpdateStatus) {
    const nextPhase = nextWaitingForWifiPromptPhase(phase(), next, offered);
    if (nextPhase === 'offer') offered = true;
    setPhase(nextPhase);
  }

  function close() {
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

  return { phase, observe, close, download, restart };
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
