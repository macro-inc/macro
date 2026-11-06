import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  HarnessOwnerConflictError,
  usePatchHarnessMutation,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery, useIsTeamOwner } from '@queries/team/teams';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import type { BoundHarnessAgent } from '@service-storage/generated/schemas/boundHarnessAgent';
import type { RequestedHarnessOwner } from '@service-storage/generated/schemas/requestedHarnessOwner';
import { Button, confirmDialog, Dialog, Panel, ToggleSwitch } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction, StatusDot } from '../integration-ui';
import { ChoiceRow, SettingsCard } from '../primitives';

type HarnessShare = 'Private' | 'Team';

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
  onRename: () => void;
  onRemove: () => void;
}) {
  const patchHarness = usePatchHarnessMutation();
  const userId = useUserId();
  const currentTeamQuery = useCurrentTeamQuery();
  const isTeamOwner = useIsTeamOwner();
  const currentTeamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;
  const [pendingShare, setPendingShare] = createSignal<HarnessShare>();
  const [blockingAgents, setBlockingAgents] =
    createSignal<BoundHarnessAgent[]>();

  // The server's manage rule: a private runtime's owner, or a team runtime's
  // registrant or team owner.
  const canManage = () =>
    match(props.harness.owner)
      .with({ type: 'user' }, (owner) => owner.user_id === userId())
      .with(
        { type: 'team' },
        (owner) =>
          props.harness.created_by === userId() ||
          (isTeamOwner() && owner.team_id === currentTeamId())
      )
      .exhaustive();
  const share = (): HarnessShare =>
    pendingShare() ??
    (props.harness.owner.type === 'team' ? 'Team' : 'Private');

  const requestedOwner = (
    target: HarnessShare
  ): RequestedHarnessOwner | undefined =>
    match(target)
      .with('Private', (): RequestedHarnessOwner => ({ type: 'user' }))
      .with('Team', () => {
        const teamId = currentTeamId();
        return teamId ? { type: 'team' as const, team_id: teamId } : undefined;
      })
      .exhaustive();

  const confirmShare = (target: HarnessShare) =>
    confirmDialog(
      match(target)
        .with('Team', () => ({
          title: `Share ${props.harness.name} with your team?`,
          body: 'Everyone on your team can run their agents on this machine, with its files and tools.',
          confirmLabel: 'Share',
        }))
        .with('Private', () => ({
          title: `Make ${props.harness.name} private?`,
          body: 'Only you will be able to run agents on this machine. Agents other people run on it must move to another runtime first.',
          confirmLabel: 'Make private',
        }))
        .exhaustive()
    );

  const setShare = async (target: HarnessShare) => {
    const owner = requestedOwner(target);
    if (!owner) return;
    setPendingShare(target);
    try {
      if (!(await confirmShare(target))) return;
      await patchHarness.mutateAsync({
        harnessId: props.harness.id,
        owner,
      });
    } catch (error) {
      if (error instanceof HarnessOwnerConflictError) {
        setBlockingAgents(error.blockingAgents);
        return;
      }
      toast.failure(
        failureMessage(error, 'Failed to change who can use this runtime')
      );
    } finally {
      setPendingShare(undefined);
    }
  };

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
          <ConnectAction
            label="Remove"
            variant="danger"
            onClick={props.onRemove}
          />
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
      <Show when={canManage()}>
        <fieldset class="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-2">
          <legend class="mb-2 text-xs text-ink">Who can use it</legend>
          <ChoiceRow
            name={`harness-share-${props.harness.id}`}
            value="private"
            checked={share() === 'Private'}
            title="Private"
            description="Only you can run agents on this runtime."
            disabled={patchHarness.isPending}
            onChange={() =>
              fireAndForget(setShare('Private'), 'harness-settings')
            }
          />
          <ChoiceRow
            name={`harness-share-${props.harness.id}`}
            value="team"
            checked={share() === 'Team'}
            title="Team"
            description={
              currentTeamId() !== undefined
                ? 'Your team can run agents on this runtime.'
                : 'Create or join a team before sharing runtimes.'
            }
            disabled={patchHarness.isPending || currentTeamId() === undefined}
            onChange={() => fireAndForget(setShare('Team'), 'harness-settings')}
          />
        </fieldset>
      </Show>
      <Show when={blockingAgents()}>
        {(agents) => (
          <OwnerChangeBlockedDialog
            harnessName={props.harness.name}
            agents={agents()}
            onClose={() => setBlockingAgents(undefined)}
          />
        )}
      </Show>
    </div>
  );
}

/** The agents that keep a runtime from changing who can use it. */
function OwnerChangeBlockedDialog(props: {
  harnessName: string;
  agents: BoundHarnessAgent[];
  onClose: () => void;
}) {
  const ownerLabel = (agent: BoundHarnessAgent) =>
    match(agent.owner)
      .with({ type: 'team' }, () => 'Team agent')
      .with(
        { type: 'user' },
        (owner) => getDisplayName(tryMacroId(owner.user_id)) || 'Private agent'
      )
      .exhaustive();

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Move these agents first
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-3 p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            These agents run on {props.harnessName} and would lose access to it.
            Move them to another runtime, then try again.
          </Dialog.Description>
          <ul class="flex flex-col divide-y divide-edge-muted rounded-lg border border-edge-muted">
            <For each={props.agents}>
              {(agent) => (
                <li class="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
                  <div class="min-w-0">
                    <p class="truncate text-sm text-ink">{agent.name}</p>
                    <p class="truncate text-xs text-ink-extra-muted">
                      @{agent.handle}
                    </p>
                  </div>
                  <span class="shrink-0 truncate text-xs text-ink-muted">
                    {ownerLabel(agent)}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={props.onClose}
          >
            OK
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
