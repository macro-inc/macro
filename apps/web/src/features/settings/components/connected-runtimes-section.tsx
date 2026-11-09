import { useShareRequests } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { usePatchHarnessMutation } from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, confirmDialog, ToggleSwitch } from '@ui';
import { createSignal, For, lazy, Show, Suspense } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

const RuntimeShareDialog = lazy(async () => ({
  default: (
    await import('@app/features/runtime-sharing/views/RuntimeShareDialog')
  ).RuntimeShareDialog,
}));

/** The owner's Share button, with the menu it opens and requests waiting in it. */
function ShareRuntime(props: { harness: RegisteredHarness }) {
  const [open, setOpen] = createSignal(false);
  const requests = useShareRequests(
    () => shareEntity('harness', props.harness.id),
    () => true
  );
  const pending = () => requests.state()?.pendingCount ?? 0;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={
          pending() > 0
            ? t('runtimeSharing.shareRequests', { count: pending() })
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        {t('runtimeSharing.share')}
        <Show when={pending() > 0}>
          <span class="text-xs text-accent-ink">{pending()}</span>
        </Show>
      </Button>
      <Show when={open()}>
        <Suspense>
          <RuntimeShareDialog
            harness={props.harness}
            open={open()}
            onOpenChange={setOpen}
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
 * The machines paired to this account, connected ones first.
 *
 * Nothing is shown until at least one runtime is connected: with none, the
 * setup cards above are the only useful thing on the page, and a list of
 * machines that cannot run anything reads as a fault. Disconnected runtimes
 * stay listed once any sibling is connected, because removing a stale pairing
 * is the reason to come here.
 */
export function ConnectedRuntimesSection(props: {
  harnesses: readonly RegisteredHarness[];
  /** Runtimes that are the team's Macro computers; release them, not remove. */
  computerHarnessIds: ReadonlySet<string>;
  /** The runtimes could not be loaded; say so rather than show an empty page. */
  error: boolean;
  onRename: (harness: RegisteredHarness) => void;
  onRemove: (harness: RegisteredHarness) => void;
  /** A team's owner can also take a machine the team runs on out of service. */
  canRemoveShared: boolean;
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
            Connected runtimes
          </h2>
        </Show>
        <SettingsCard>
          <For each={ordered()}>
            {(harness) => (
              <PairedRuntimeRow
                harness={harness}
                isComputer={props.computerHarnessIds.has(harness.id)}
                canRemoveShared={props.canRemoveShared}
                onRename={() => props.onRename(harness)}
                onRemove={() => props.onRemove(harness)}
              />
            )}
          </For>
          <Show when={props.error}>
            <p class="px-4 py-3 text-xs text-negative">
              Could not load your runtimes. Try refreshing this page.
            </p>
          </Show>
        </SettingsCard>
      </div>
    </Show>
  );
}

/**
 * One paired macrod runtime. Its name, owner and permission bypass live here
 * on the web; macrod.toml on the machine holds only machine-local config.
 */
function PairedRuntimeRow(props: {
  harness: RegisteredHarness;
  isComputer: boolean;
  canRemoveShared: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const patchHarness = usePatchHarnessMutation();

  const setBypass = async (allowed: boolean) => {
    if (allowed) {
      const confirmed = await confirmDialog({
        title: 'Allow bypassing permission requests?',
        body: 'Agents set to bypass can run commands and edit files on this machine without approval. Only enable this if you trust everyone who can create agents on this runtime.',
        confirmLabel: 'Allow',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await patchHarness.mutateAsync({
        harnessId: props.harness.id,
        allowPermissionBypass: allowed,
      });
    } catch (error) {
      toast.failure(
        failureMessage(error, 'Failed to change permission requests')
      );
    }
  };

  return (
    <div class="flex flex-col gap-3 px-4 py-3">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="min-w-0 flex-1 truncate text-sm text-ink">
              {props.harness.name}
            </p>
            <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-edge-muted px-2 text-xxs/none font-medium uppercase text-ink-extra-muted">
              {(props.harness.shared_team_ids?.length ?? 0) > 0
                ? 'Team machine'
                : 'Private'}
            </span>
            <Show when={props.isComputer}>
              <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-accent-bg px-2 text-[11px]/none font-medium text-accent">
                Macro computer
              </span>
            </Show>
            <StatusDot
              state={props.harness.connected ? 'connected' : 'disconnected'}
              label={props.harness.connected ? 'Connected' : 'Offline'}
            />
          </div>
          <p class="mt-0.5 truncate text-xs text-ink-extra-muted">
            {lastConnectedText(props.harness)}
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Show when={props.harness.access === 'owner'}>
            <ShareRuntime harness={props.harness} />
            <ConnectAction
              label="Rename"
              variant="neutral"
              onClick={props.onRename}
            />
          </Show>
          <Show
            when={
              !props.isComputer &&
              (props.harness.access === 'owner' ||
                (props.canRemoveShared &&
                  (props.harness.shared_team_ids?.length ?? 0) > 0))
            }
          >
            <ConnectAction
              label="Remove"
              variant="danger"
              onClick={props.onRemove}
            />
          </Show>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <ToggleSwitch
          size="md"
          label="Allow bypassing permission requests"
          labelClass="text-xs text-ink"
          checked={props.harness.allow_permission_bypass}
          disabled={props.harness.access !== 'owner' || patchHarness.isPending}
          onChange={(allowed) =>
            fireAndForget(setBypass(allowed), 'harness-settings')
          }
        />
        <p class="text-xs text-ink-extra-muted">
          {props.harness.allow_permission_bypass
            ? 'Agents set to Always bypass approve tool calls without asking, from their next turn.'
            : 'Every agent on this runtime must ask for permission.'}
        </p>
      </div>
    </div>
  );
}
