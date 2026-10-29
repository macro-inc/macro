import { AGENTS_TOUR } from '@app/features/agents-view/tour';
import { useCodexAgentsAccess } from '@core/codex/flag';
import { toast } from '@core/component/Toast/Toast';
import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, Dialog, Panel } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, For, Show } from 'solid-js';
import { CodexHarness } from './codex/views/CodexHarness';
import { LocalRuntimeCard } from './components/local-runtime-card';
import { ConnectAction, HarnessIcon, StatusDot } from './integration-ui';
import { SettingsCard } from './primitives';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Never connected';
}

/**
 * The Runtimes section at the foot of the Agents page: this computer, the
 * built-in runtimes, and machines paired with macrod.
 */
export function AgentRuntimes(props: { onNewRuntime: () => void }) {
  const canUseCodex = useCodexAgentsAccess();
  const harnessesQuery = useHarnessesQuery();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const [removingHarness, setRemovingHarness] =
    createSignal<RegisteredHarness>();
  const setup = tourTarget(AGENTS_TOUR.agentSetup);

  const removeHarness = async () => {
    const current = removingHarness();
    if (!current) return;

    try {
      await deleteHarnessMutation.mutateAsync({ harnessId: current.id });
      setRemovingHarness(undefined);
      toast.success('Runtime removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove runtime'));
    }
  };

  return (
    <section
      ref={setup}
      aria-label="Runtimes"
      data-settings-target="runtimes"
      tabIndex={-1}
      class="flex scroll-mt-4 flex-col gap-4 outline-none"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="text-base font-medium text-ink">Runtimes</h2>
          <p class="text-sm leading-relaxed text-ink/60">
            Where coding agents run besides Macro: this computer, Codex, or a
            machine you pair with macrod.
          </p>
        </div>
        <Button variant="neutral" size="sm" onClick={props.onNewRuntime}>
          <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
          New runtime
        </Button>
      </div>
      <LocalRuntimeCard />
      <div>
        <h3 class="mb-2 text-sm font-medium text-ink-muted">
          Built-in runtimes
        </h3>
        <SettingsCard>
          <section class="flex gap-4 px-6 py-5">
            <HarnessIcon>
              <HardDrivesIcon />
            </HarnessIcon>
            <div class="min-w-0 flex-1">
              <div class="flex min-h-5 items-start justify-between gap-3">
                <h4 class="min-w-0 text-sm/5 font-medium text-ink">
                  {MACRO_HARNESS_NAME}
                </h4>
                <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                  Built in
                </span>
              </div>
              <p class="mt-1 text-sm text-ink-muted">
                Macro in house fast and powerful agent. Uses official Macro
                tools and MCPs to get the job done.
              </p>
            </div>
          </section>
          <Show when={canUseCodex()}>
            <CodexHarness />
          </Show>
        </SettingsCard>
      </div>

      <Show when={!harnessesQuery.isSuccess || harnessesQuery.data.length > 0}>
        <div>
          <h3 class="mb-2 text-sm font-medium text-ink-muted">
            Paired runtimes
          </h3>
          <SettingsCard>
            <For
              each={harnessesQuery.isSuccess ? harnessesQuery.data : []}
              fallback={
                <div class="flex flex-col items-center py-6 text-center">
                  <p class="text-sm text-ink">
                    {harnessesQuery.isError
                      ? 'Could not load runtimes.'
                      : 'Loading runtimes…'}
                  </p>
                </div>
              }
            >
              {(harness) => (
                <div class="flex items-center justify-between gap-4 px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <p class="min-w-0 flex-1 truncate text-sm text-ink">
                        {harness.name}
                      </p>
                      <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-edge-muted px-2 text-xxs/none font-medium uppercase text-ink-extra-muted">
                        {harness.owner.type === 'team' ? 'Team' : 'Private'}
                      </span>
                      <StatusDot
                        state={harness.connected ? 'connected' : 'disconnected'}
                        label={harness.connected ? 'Connected' : 'Disconnected'}
                      />
                    </div>
                    <p class="mt-0.5 truncate text-xs text-ink-extra-muted">
                      {lastConnectedText(harness)}
                    </p>
                  </div>
                  <div class="shrink-0">
                    <ConnectAction
                      label="Remove"
                      variant="danger"
                      onClick={() => setRemovingHarness(harness)}
                    />
                  </div>
                </div>
              )}
            </For>
            <Show when={harnessesQuery.isError}>
              <p class="px-4 py-3 text-xs text-negative">
                Could not load your runtimes. Try refreshing this page.
              </p>
            </Show>
          </SettingsCard>
        </div>
      </Show>

      <Show when={removingHarness()} keyed>
        {(harness) => (
          <HarnessRemoveDialog
            harnessName={harness.name}
            pending={deleteHarnessMutation.isPending}
            onClose={() => setRemovingHarness(undefined)}
            onConfirm={() => fireAndForget(removeHarness(), 'harness-settings')}
          />
        )}
      </Show>
    </section>
  );
}

function HarnessRemoveDialog(props: {
  harnessName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Remove {props.harnessName}?
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            Agents using this runtime will stop running until it's reconnected.
            macrod on that machine will need to pair again.
          </Dialog.Description>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.pending ? 'Removing…' : 'Remove runtime'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
