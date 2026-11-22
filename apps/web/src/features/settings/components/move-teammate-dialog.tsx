import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  useMoveTeamAgentMutation,
  useRecheckTeammateHostMutation,
  useTeammateHostsQuery,
} from '@queries/team-agents/hosts';
import type { TeamAgent } from '@service-auth/team-agents';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { TeammateHostPicker } from './teammate-host-picker';

function MoveTeammate(props: {
  teamId: string;
  agent: TeamAgent;
  onClose: () => void;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const hosts = useTeammateHostsQuery(
    () => props.teamId,
    () => true
  );
  const move = useMoveTeamAgentMutation();
  const recheck = useRecheckTeammateHostMutation();
  const [chosen, setChosen] = createSignal<string>();
  // Only another machine that can host it now; a parked agent runs
  // nowhere, so the machine it was stopped on counts too.
  const parked = () => props.agent.installProblem?.kind === 'hostRemoved';
  const candidates = () =>
    hosts.isSuccess
      ? hosts.data.hosts.filter(
          (host) => parked() || host.harnessId !== props.agent.harnessId
        )
      : undefined;
  const from = () =>
    (hosts.isSuccess &&
      hosts.data.hosts.find((host) => host.harnessId === props.agent.harnessId)
        ?.name) ||
    t('teamAgents.ownersComputer');
  const target = () =>
    candidates()?.find(
      (host) => host.harnessId === chosen() && host.eligibility.ok
    );

  const close = () => {
    if (!move.isPending) props.onClose();
  };

  const submit = () => {
    const host = target();
    if (!host || move.isPending) return;
    const name = props.agent.name;
    move.mutate(
      {
        teamId: props.teamId,
        userId: props.agent.userId,
        harnessId: host.harnessId,
      },
      {
        onSuccess: () => {
          if (!disposed) props.onClose();
        },
        onError: () => toast.failure(t('teammateHosts.moveFailed', { name })),
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()} class="w-120">
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-3 gap-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.close')}
          >
            <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </Dialog.CloseButton>
          <Dialog.Title
            as="span"
            class="text-base font-medium p-0 m-0 truncate"
          >
            {t('teammateHosts.moveTitle', { name: props.agent.name })}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body>
          <div class="flex flex-col gap-4 px-5 py-5">
            <p class="text-sm text-ink-muted">
              {parked()
                ? t('teammateHosts.moveBodyParked', { name: props.agent.name })
                : t('teammateHosts.moveBody', {
                    name: props.agent.name,
                    from: from(),
                  })}
            </p>
            <TeammateHostPicker
              hosts={candidates()}
              failed={hosts.isError}
              onRetry={() =>
                fireAndForget(hosts.refetch(), 'team-agent.move.hosts')
              }
              onRecheck={(harnessId) =>
                recheck.mutate({ teamId: props.teamId, harnessId })
              }
              selected={target()?.harnessId}
              onSelect={setChosen}
              disabled={move.isPending}
              empty={t('teammateHosts.moveNoOtherHost', {
                name: props.agent.name,
              })}
            />
          </div>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={move.isPending}
            onClick={close}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!target()}
            // Pressable while moving so it keeps its ink; `submit` ignores
            // presses meanwhile.
            aria-disabled={move.isPending || undefined}
            aria-busy={move.isPending || undefined}
            data-disabled={move.isPending ? '' : undefined}
            onClick={submit}
          >
            <Show
              when={move.isPending}
              fallback={t('teammateHosts.moveConfirm')}
            >
              <SpinnerIcon class="size-4 shrink-0 animate-spin" />
              {t('teammateHosts.moving')}
            </Show>
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

/** An admin's Move dialog for an agent on one of their own machines; closed without one. */
export function MoveTeammateDialog(props: {
  teamId: string;
  agent: TeamAgent | undefined;
  onClose: () => void;
}) {
  return (
    <Show keyed when={props.agent}>
      {(agent) => (
        <MoveTeammate
          teamId={props.teamId}
          agent={agent}
          onClose={props.onClose}
        />
      )}
    </Show>
  );
}
