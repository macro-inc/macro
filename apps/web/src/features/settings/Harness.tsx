import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useCodexAgentsAccess } from '@core/codex/flag';
import { toast } from '@core/component/Toast/Toast';
import { claudeCloud } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { ThrownResultError } from '@core/util/result';
import MacroLogo from '@icon/macro-logo.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import DesktopIcon from '@phosphor/desktop.svg';
import PlusIcon from '@phosphor/plus.svg';
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { useSearchParams } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, onMount, Show, Suspense } from 'solid-js';
import { ClaudeConnection } from '../claude-connection/claude-connection';
import { CodexHarness } from './codex/views/CodexHarness';
import { HarnessPairingDialog } from './HarnessPairingDialog';
import { HarnessIcon, StatusDot } from './integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';
import { RuntimeRow } from './runtimes/components/runtime-row';
import { CursorRuntime } from './runtimes/cursor-runtime';

const BYOA_DOCS_URL = 'https://docs.macro.com/AI/bring-your-own';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Waiting for the first connection';
}

/** Production entry point for the runtimes settings screen. */
export function Harness() {
  return (
    <Suspense
      fallback={<p class="p-6 text-sm text-ink-muted">Loading runtimes…</p>}
    >
      <RuntimeSettings />
    </Suspense>
  );
}

function RuntimeSettings() {
  const canUseCodex = useCodexAgentsAccess();
  const claudeCloudFlag = useFeatureFlag(claudeCloud);
  const harnessesQuery = useHarnessesQuery();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  const canRemove = (harness: RegisteredHarness) => {
    const currentUser = userId();
    if (!currentUser) return false;
    if (harness.owner.type === 'user')
      return harness.owner.user_id === currentUser;
    if (harness.created_by === currentUser) return true;
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    return (
      team?.team.id === harness.owner.team_id &&
      team.members.some(
        (member) => member.user_id === currentUser && member.role === 'owner'
      )
    );
  };
  const [pairingDialog, setPairingDialog] = createSignal<{
    initialCode?: string;
  }>();
  const [removingHarness, setRemovingHarness] =
    createSignal<RegisteredHarness>();
  const [searchParams, setSearchParams] = useSearchParams();

  onMount(() => {
    const pair = searchParams.pair;
    if (typeof pair === 'string' && pair.length > 0) {
      setPairingDialog({ initialCode: pair });
      setSearchParams({ pair: undefined }, { replace: true });
    }
  });

  const removeHarness = async () => {
    const current = removingHarness();
    if (!current || deleteHarnessMutation.isPending) return;
    try {
      await deleteHarnessMutation.mutateAsync({ harnessId: current.id });
      setRemovingHarness(undefined);
      toast.success('Runtime removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove runtime'));
    }
  };

  return (
    <SettingsPage
      title="Runtimes"
      description="Choose where your agents work. Connect an account or pair your own computer."
    >
      <SettingsSection title="Cloud runtimes">
        <SettingsCard>
          <RuntimeRow
            name="Macro"
            description="Work with your documents, messages, and workspace."
            icon={<MacroLogo />}
            status="Built in"
            connected
          />
          <Show when={claudeCloudFlag().enabled}>
            <ClaudeConnection />
          </Show>
          <CursorRuntime />
          <Show when={canUseCodex()}>
            <CodexHarness />
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Your computers">
        <SettingsCard>
          <section class="px-5 py-5 mobile:px-4">
            <div class="flex items-start gap-3">
              <HarnessIcon>
                <DesktopIcon />
              </HarnessIcon>
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-medium text-ink">
                  Run agents on your computer
                </h2>
                <p class="mt-1 text-xs leading-5 text-ink-muted">
                  Give agents access to your local tools and projects. Connect a
                  computer with macrod, then choose it when creating an agent.
                </p>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="cta"
                    size="sm"
                    onClick={() => setPairingDialog({})}
                  >
                    <PlusIcon class="size-3.5" />
                    Pair a runtime
                  </Button>
                  <a
                    href={BYOA_DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-xs font-medium text-ink-muted outline-none hover:text-ink focus-visible:underline"
                  >
                    Setup guide
                    <ArrowUpRightIcon class="size-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </section>
          <Show when={harnessesQuery.isError}>
            <div class="flex items-center justify-between gap-3 px-5 py-4">
              <p role="alert" class="text-xs text-negative">
                Could not load your paired runtimes.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void harnessesQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          </Show>
          <Show when={!harnessesQuery.isError}>
            <For
              each={harnessesQuery.isSuccess ? harnessesQuery.data : []}
              fallback={
                <p class="px-5 py-4 text-xs text-ink-extra-muted">
                  {harnessesQuery.isPending
                    ? 'Loading paired runtimes…'
                    : 'No computers paired yet. Your runtimes will appear here.'}
                </p>
              }
            >
              {(harness) => (
                <div class="flex items-start gap-3 px-5 py-4 mobile:px-4">
                  <HarnessIcon>
                    <DesktopIcon />
                  </HarnessIcon>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="break-words text-sm font-medium text-ink">
                        {harness.name}
                      </h3>
                      <span class="rounded border border-edge-muted px-1.5 py-0.5 text-[10px] text-ink-muted">
                        {harness.owner.type === 'team' ? 'Team' : 'Private'}
                      </span>
                    </div>
                    <p class="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                      <StatusDot
                        state={harness.connected ? 'connected' : 'disconnected'}
                        label={harness.connected ? 'Connected' : 'Offline'}
                      />
                      {harness.connected ? 'Connected' : 'Offline'}
                    </p>
                    <p class="mt-1 text-[11px] leading-4 text-ink-extra-muted">
                      {lastConnectedText(harness)}
                    </p>
                  </div>
                  <Show when={canRemove(harness)}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${harness.name}`}
                      onClick={() => setRemovingHarness(harness)}
                    >
                      Remove
                    </Button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </SettingsCard>
        <p class="px-6 text-xs leading-5 text-ink-extra-muted">
          Private runtimes are only available to you. Team runtimes can be used
          by everyone on your team.
        </p>
      </SettingsSection>
      <Show when={pairingDialog()} keyed>
        {(dialog) => (
          <HarnessPairingDialog
            initialCode={dialog.initialCode}
            onClose={() => setPairingDialog(undefined)}
          />
        )}
      </Show>
      <Show when={removingHarness()} keyed>
        {(harness) => (
          <HarnessRemoveDialog
            harnessName={harness.name}
            pending={deleteHarnessMutation.isPending}
            onClose={() => setRemovingHarness(undefined)}
            onConfirm={() => void removeHarness()}
          />
        )}
      </Show>
    </SettingsPage>
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
            Agents using this runtime will need another runtime. Pair this
            computer again to use it in Macro.
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
            variant="danger"
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
