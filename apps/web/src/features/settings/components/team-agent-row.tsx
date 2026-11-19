import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import { UserIcon } from '@core/component/UserIcon';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import WaveformIcon from '@icon/system/regular/waveform.svg';
import type { TeamAgent } from '@service-auth/team-agents';
import { Button, Dropdown, Tooltip } from '@ui';
import { type JSX, onCleanup, Show } from 'solid-js';
import { TeamAgentStatusLabel } from './team-agent-status';

/**
 * An agent teammate in Team › Members, laid out like a person's row: its
 * picture and name, what it does, and its status where a person's role is.
 */
export function TeamAgentRow(props: {
  agent: TeamAgent;
  /** Team admins and owners may remove agents. */
  canRemove: boolean;
  onRemove: () => void;
  /** Opens Change picture; left out for viewers who can't change it. */
  onChangePicture?: (opener: HTMLButtonElement | undefined) => void;
  /** Opens Change voice; left out for viewers who can't change it. */
  onChangeVoice?: () => void;
  /** Which Claude its computer runs on, for viewers who manage it. */
  claude?: JSX.Element;
  /** The step its computer's setup is on, while it is being set up. */
  setupStep?: string;
  /** Sets its failed computer up again; for viewers who manage it. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  let menuTrigger: HTMLButtonElement | undefined;
  let disposed = false;
  let pendingPicture:
    | { userId: string; run: (opener: HTMLButtonElement | undefined) => void }
    | undefined;
  onCleanup(() => {
    disposed = true;
  });
  const finishMenuClose = (event: Event) => {
    const action = pendingPicture;
    pendingPicture = undefined;
    if (!action) return;
    event.preventDefault();
    // Let the menu restore its pointer layer before the picture drawer opens.
    queueMicrotask(() => {
      if (
        disposed ||
        props.agent.userId !== action.userId ||
        !props.onChangePicture
      )
        return;
      menuTrigger?.focus({ preventScroll: true });
      action.run(menuTrigger);
    });
  };
  return (
    <div
      data-member-kind="agent"
      class="flex items-center justify-between gap-2 px-4 py-4 touch:min-h-[44px]"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="shrink-0">
          <UserIcon id={props.agent.userId} isDeleted={false} size="lg" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="text-sm font-medium text-ink truncate">
              {props.agent.name}
            </div>
            <AgentTag />
          </div>
          <div class="text-xs text-ink-muted truncate">
            {props.agent.jobDescription}
          </div>
          {/* A phone row has no room beside the name: the status goes under it. */}
          <div class="sm:hidden">
            <TeamAgentStatusLabel status={props.agent.status} />
          </div>
          <Show when={props.setupStep}>
            {(step) => (
              <div
                data-agent-setup-step
                class="text-xs text-ink-muted truncate"
              >
                {step()}
              </div>
            )}
          </Show>
          {/* Under the description, like the Claude line's action. */}
          <Show when={props.onRetry}>
            {(retry) => (
              <button
                type="button"
                data-agent-setup-retry
                class="text-xs font-medium text-ink underline-offset-2 not-touch:hover:underline disabled:opacity-50 touch:py-1.5"
                disabled={props.retrying}
                onClick={() => retry()()}
              >
                {t('teamAgents.retrySetup')}
              </button>
            )}
          </Show>
          {props.claude}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div class="max-sm:hidden">
          <TeamAgentStatusLabel status={props.agent.status} />
        </div>
        <Show when={props.onChangeVoice}>
          {(changeVoice) => (
            <Tooltip label={t('teamAgents.changeVoice')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('teamAgents.changeVoice')}
                onClick={() => changeVoice()()}
              >
                <WaveformIcon class="size-4" />
              </Button>
            </Tooltip>
          )}
        </Show>
        <Show when={props.onChangePicture}>
          {(changePicture) => (
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                ref={menuTrigger}
                variant="ghost"
                size="sm"
                aria-label={t('agentFaces.agentOptions')}
              >
                <DotsThreeIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content onCloseAutoFocus={finishMenuClose}>
                <Dropdown.Item
                  onSelect={() => {
                    pendingPicture = {
                      userId: props.agent.userId,
                      run: changePicture(),
                    };
                  }}
                >
                  <ImageIcon class="size-4" />
                  {t('agentFaces.changePicture')}
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown>
          )}
        </Show>
        <Show when={props.canRemove}>
          <Tooltip label={t('teamAgents.remove')}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('teamAgents.remove')}
              onClick={() => props.onRemove()}
            >
              <TrashIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
      </div>
    </div>
  );
}
