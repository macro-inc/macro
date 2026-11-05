import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { usePatchHarnessMutation } from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { confirmDialog, ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
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
              {props.harness.owner.type === 'team' ? 'Team' : 'Private'}
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
        <div class="flex shrink-0 items-center gap-1">
          <ConnectAction
            label="Rename"
            variant="neutral"
            onClick={props.onRename}
          />
          <Show when={!props.isComputer}>
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
          disabled={patchHarness.isPending}
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
