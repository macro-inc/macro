import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  useMoveTeamAgentMutation,
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
  const [chosen, setChosen] = createSignal<string>();
  // Only another machine that can host it now.
  const candidates = () =>
    hosts.isSuccess
      ? hosts.data.hosts.filter(
          (host) => host.harnessId !== props.agent.harnessId
        )
      : undefined;
  const from = () =>
    (hosts.isSuccess &&
      hosts.data.hosts.find((host) => host.harnessId === props.agent.harnessId)
        ?.name) ||
    t('teammateHosts.ownComputer');
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
              {t('teammateHosts.moveBody', {
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
              selected={target()?.harnessId}
              onSelect={setChosen}
              disabled={move.isPending}
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
            disabled={!target() || move.isPending}
            onClick={submit}
          >
            <Show
              when={move.isPending}
              fallback={t('teammateHosts.moveConfirm')}
            >
              <SpinnerIcon class="size-4 animate-spin" />
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
