import type { PhrasePart } from '@app/features/agent-permissions';
import { t } from '@app/lib/i18n';
import { Button, Card } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';

export type PermissionRequestCardProps = {
  /** The viewer answers: approve once, for the session, or deny. */
  canApprove: boolean;
  /** "Allow Scout to send email?", with its verbs and entities accented. */
  request: readonly PhrasePart[];
  /** Whom everyone else waits for, by name. */
  approver: string;
  /** What the agent wants to do, for everyone else. */
  waitingDescription: string;
  /** The viewer may give up waiting on the approver. */
  canCancel: boolean;
  /** Offer Edit permissions (the flag is on and the viewer may edit). */
  canEditPermissions: boolean;
  /** An answer is on the wire. */
  disabled?: boolean;
  onApproveOnce: () => void;
  onAllowInSession: () => void;
  onDeny: () => void;
  onEditPermissions: () => void;
  onCancel: () => void;
};

/**
 * A program held on the agent's permissions, docked above the composer: the
 * approver allows it once, for the session, or denies it; everyone else
 * waits and may cancel. The buttons share one row on a wide card and stack,
 * Allow first, on a narrow one.
 */
export function PermissionRequestCard(props: PermissionRequestCardProps) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label={t('agentPermissionsChat.approvalLabel')}
      class="@container/request gap-3 px-[18px] py-4"
    >
      <Switch>
        <Match when={props.canApprove}>
          <p class="text-base leading-5 text-ink [overflow-wrap:anywhere]">
            <For each={props.request}>
              {(part) => (
                <Show when={part.accent} fallback={part.text}>
                  <span class="text-accent">{part.text}</span>
                </Show>
              )}
            </For>
          </p>
          <div class="mt-1 flex flex-col-reverse gap-2 @[30rem]/request:flex-row @[30rem]/request:items-center @[30rem]/request:justify-between @[30rem]/request:gap-3">
            <div class="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={props.disabled}
                onClick={() => props.onDeny()}
              >
                {t('agentPermissionsChat.deny')}
              </Button>
              <Show when={props.canEditPermissions}>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => props.onEditPermissions()}
                >
                  {t('agentPermissionsChat.editPermissions')}
                </Button>
              </Show>
            </div>
            <div class="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="md"
                class="flex-1 @[30rem]/request:flex-none"
                disabled={props.disabled}
                onClick={() => props.onApproveOnce()}
              >
                {t('agentPermissionsChat.allowOnce')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                class="flex-1 @[30rem]/request:flex-none"
                disabled={props.disabled}
                onClick={() => props.onAllowInSession()}
              >
                {t('agentPermissionsChat.allowInSession')}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={!props.canApprove}>
          <div class="flex min-w-0 flex-col gap-1">
            <p class="text-sm leading-5 font-medium text-ink">
              {t('agentPermissionsChat.waitingFor', { name: props.approver })}
            </p>
            <p class="text-sm leading-5 text-ink-muted [overflow-wrap:anywhere]">
              {props.waitingDescription}
            </p>
          </div>
          <Show when={props.canCancel}>
            <Button
              type="button"
              variant="ghost"
              size="md"
              class="self-end"
              disabled={props.disabled}
              onClick={() => props.onCancel()}
            >
              {t('agentPermissionsChat.cancelRequest')}
            </Button>
          </Show>
        </Match>
      </Switch>
    </Card>
  );
}
