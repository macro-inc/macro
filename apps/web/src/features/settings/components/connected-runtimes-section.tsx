import { useShareRequests } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { t } from '@app/lib/i18n';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button } from '@ui';
import { For, type JSX, lazy, Show, Suspense } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';
import { RuntimeOptions } from './runtime-options';

export const RuntimeShareDialog = lazy(async () => ({
  default: (
    await import('@app/features/runtime-sharing/views/RuntimeShareDialog')
  ).RuntimeShareDialog,
}));

/** The owner's Share button and the menu it opens. */
function ShareRuntime(props: {
  harness: RegisteredHarness;
  pending: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={
          props.pending > 0
            ? t('runtimeSharing.shareRequests', { count: props.pending })
            : undefined
        }
        onClick={() => props.onOpenChange(true)}
      >
        {t('runtimeSharing.share')}
      </Button>
      <Show when={props.open}>
        <Suspense>
          <RuntimeShareDialog
            harness={props.harness}
            open={props.open}
            onOpenChange={props.onOpenChange}
          />
        </Suspense>
      </Show>
    </>
  );
}

function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Never connected';
}

/**
 * A runtime's status dot and name. The name wraps on narrow rows rather than
 * truncating, and the dot stays on its first line.
 */
export function RuntimeName(props: { harness: RegisteredHarness }) {
  return (
    <MachineName
      dot={
        <StatusDot
          state={props.harness.connected ? 'connected' : 'disconnected'}
          label={props.harness.connected ? 'Connected' : 'Offline'}
        />
      }
      name={props.harness.name}
    />
  );
}

/** A machine's leading dot (or glyph) and its name, aligned for every row. */
function MachineName(props: { dot: JSX.Element; name: string }) {
  return (
    <div class="flex min-w-0 items-start gap-2 text-sm">
      <span class="flex h-[1lh] w-2 shrink-0 items-center justify-center">
        {props.dot}
      </span>
      <p class="min-w-0 truncate text-sm font-medium text-ink @max-[480px]:whitespace-normal @max-[480px]:break-words">
        {props.name}
      </p>
    </div>
  );
}

/**
 * The machine row every section of Machines uses: dot and name, one muted
 * meta line, and actions top-right that drop onto their own line on narrow
 * rows.
 */
export function MachineRow(props: {
  dot: JSX.Element;
  name: string;
  meta: JSX.Element;
  actions?: JSX.Element;
  /** The settings search and notification landing target. */
  target?: string;
}) {
  return (
    <div
      class="flex items-start justify-between gap-4 px-4 py-3 transition-colors @max-[480px]:flex-col @max-[480px]:gap-2 [&.ring-2]:bg-accent-bg/50 [&.ring-2]:ring-inset [&.ring-offset-2]:ring-offset-0"
      data-settings-target={props.target}
      data-runtime-row={props.name}
    >
      <div class="min-w-0 flex-1">
        <MachineName dot={props.dot} name={props.name} />
        <p class="mt-0.5 pl-4 text-xs text-ink-extra-muted">{props.meta}</p>
      </div>
      <Show when={props.actions}>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1 @max-[480px]:justify-start @max-[480px]:pl-2">
          {props.actions}
        </div>
      </Show>
    </div>
  );
}

/**
 * The machines the viewer owns, connected ones first.
 *
 * Nothing is shown until at least one runtime is connected: with none, the
 * setup cards above are the only useful thing on the page, and a list of
 * machines that cannot run anything reads as a fault. Disconnected runtimes
 * stay listed once any sibling is connected, because removing a stale pairing
 * is the reason to come here.
 */
export function ConnectedRuntimesSection(props: {
  harnesses: readonly RegisteredHarness[];
  /** The runtimes could not be loaded; say so rather than show an empty page. */
  error: boolean;
  onRename: (harness: RegisteredHarness) => void;
  onRemove: (harness: RegisteredHarness) => void;
  /** The runtime whose Share menu is open. */
  sharing?: string;
  onSharingChange: (harnessId: string | undefined) => void;
}) {
  const connectedCount = () =>
    props.harnesses.filter((harness) => harness.connected).length;
  const ordered = () => [
    ...props.harnesses.filter((harness) => harness.connected),
    ...props.harnesses.filter((harness) => !harness.connected),
  ];

  return (
    <Show when={connectedCount() > 0 || props.error}>
      <div>
        <Show when={connectedCount() > 0}>
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            {t('runtimeSharing.yourRuntimes')}
          </h2>
        </Show>
        <SettingsCard>
          <For each={ordered()}>
            {(harness) => (
              <PairedRuntimeRow
                harness={harness}
                onRename={() => props.onRename(harness)}
                onRemove={() => props.onRemove(harness)}
                sharing={props.sharing === harness.id}
                onSharingChange={(open) =>
                  props.onSharingChange(open ? harness.id : undefined)
                }
              />
            )}
          </For>
          <Show when={props.error}>
            <p class="px-4 py-3 text-xs text-negative">
              Could not load your machines. Try refreshing this page.
            </p>
          </Show>
        </SettingsCard>
      </div>
    </Show>
  );
}

/**
 * One paired macrod runtime: its dot and name, a meta line (access, waiting
 * requests, last connection), and actions at the top right that move onto
 * their own line on narrow rows. Its name, sharing and options live here on
 * the web; macrod.toml on the machine holds only machine-local config.
 */
function PairedRuntimeRow(props: {
  harness: RegisteredHarness;
  onRename: () => void;
  onRemove: () => void;
  sharing: boolean;
  onSharingChange: (open: boolean) => void;
}) {
  const isOwner = () => props.harness.access === 'owner';
  const requests = useShareRequests(
    () => shareEntity('harness', props.harness.id),
    isOwner
  );
  const pending = () => requests.state()?.pendingCount ?? 0;
  const access = () =>
    props.harness.shared_team_ids.length > 0
      ? t('runtimeSharing.teamMachine')
      : t('runtimeSharing.private');

  return (
    <MachineRow
      target={`runtime-${props.harness.id}`}
      name={props.harness.name}
      dot={
        <StatusDot
          state={props.harness.connected ? 'connected' : 'disconnected'}
          label={props.harness.connected ? 'Connected' : 'Offline'}
        />
      }
      meta={
        <>
          {access()}
          <Show when={pending() > 0}>
            {' · '}
            <span data-runtime-pending class="font-medium text-accent-ink">
              {t('runtimeSharing.pendingRequests', { count: pending() })}
            </span>
          </Show>
          {' · '}
          {lastConnectedText(props.harness)}
        </>
      }
      actions={
        <>
          <Show when={isOwner()}>
            <ShareRuntime
              harness={props.harness}
              pending={pending()}
              open={props.sharing}
              onOpenChange={props.onSharingChange}
            />
          </Show>
          <RuntimeOptions harness={props.harness} />
          <Show when={isOwner()}>
            <ConnectAction
              label="Rename"
              variant="neutral"
              onClick={props.onRename}
            />
            <ConnectAction
              label="Remove"
              variant="danger"
              onClick={props.onRemove}
            />
          </Show>
        </>
      }
    />
  );
}
