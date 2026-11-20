import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { useAddAgentInboxMutation } from '@queries/team-agents/team-agents';
import type {
  AgentInbox,
  AgentInboxFailure,
  TeamAgent,
} from '@service-auth/team-agents';
import { Checkbox } from '@ui';
import { Match, type ParentProps, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';

function failureText(failure: AgentInboxFailure | null | undefined): string {
  return match(failure ?? 'unavailable')
    .with('not_configured', () => t('teamAgents.inboxNotConfigured'))
    .with('address_taken', () => t('teamAgents.inboxAddressTaken'))
    .with('quota_exceeded', () => t('teamAgents.inboxQuotaExceeded'))
    .with('throttled', 'unavailable', 'rejected', () =>
      t('teamAgents.inboxFailed')
    )
    .exhaustive();
}

/** A text action on the inbox line, like the row's Retry. */
function InboxAction(
  props: ParentProps<{ onClick: () => void; disabled?: boolean; data?: string }>
) {
  return (
    <button
      type="button"
      data-agent-inbox-action={props.data}
      class="text-xs font-medium text-ink underline-offset-2 not-touch:hover:underline disabled:opacity-50 touch:py-1.5"
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

async function copyAddress(address: string) {
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    toast.failure(t('teamAgents.inboxCopyFailed'));
    return;
  }
  toast.success(t('teamAgents.inboxCopied'));
}

/**
 * An agent teammate's email inbox on its row in Members: its address, an
 * Add an inbox action, or where creating it got to. Only team admins and
 * owners see it; the server refuses everyone else.
 */
export function TeamAgentInbox(props: { teamId: string; agent: TeamAgent }) {
  const add = useAddAgentInboxMutation();
  const inbox = (): AgentInbox | null | undefined => props.agent.inbox;
  const address = () =>
    inbox()?.state === 'active' ? (inbox()?.address ?? undefined) : undefined;

  const addInbox = async () => {
    try {
      await add.mutateAsync({
        teamId: props.teamId,
        userId: props.agent.userId,
      });
    } catch {
      toast.failure(t('teamAgents.inboxAddFailed', { name: props.agent.name }));
    }
  };
  const startAdding = () => fireAndForget(addInbox(), 'team-agent.add-inbox');

  return (
    <div data-agent-inbox class="flex items-center gap-1.5 min-w-0 text-xs">
      <Switch>
        <Match when={!inbox()}>
          <InboxAction
            data="add"
            disabled={add.isPending}
            onClick={startAdding}
          >
            {t('teamAgents.inboxAdd')}
          </InboxAction>
        </Match>
        <Match when={address()}>
          {(shown) => (
            <>
              <span class="text-ink-muted truncate" data-agent-inbox-address>
                {shown()}
              </span>
              <InboxAction
                data="copy"
                onClick={() =>
                  fireAndForget(copyAddress(shown()), 'team-agent.copy-inbox')
                }
              >
                {t('teamAgents.inboxCopy')}
              </InboxAction>
              <Show when={inbox()?.fakeProvider}>
                <span class="text-ink-extra-muted" data-agent-inbox-fake>
                  {t('teamAgents.inboxFakeProvider')}
                </span>
              </Show>
            </>
          )}
        </Match>
        <Match when={inbox()?.state === 'provisioning'}>
          <span class="text-ink-muted" data-agent-inbox-provisioning>
            {t('teamAgents.inboxProvisioning')}
          </span>
        </Match>
        <Match when={inbox()?.state === 'failed'}>
          <span class="text-ink-muted truncate" data-agent-inbox-failed>
            {failureText(inbox()?.failure)}
          </span>
          <InboxAction
            data="retry"
            disabled={add.isPending}
            onClick={startAdding}
          >
            {t('teamAgents.retrySetup')}
          </InboxAction>
        </Match>
      </Switch>
    </div>
  );
}

/**
 * The Invite an agent form's email option: give the agent its own address
 * once it is added. A named part the invite layout places.
 */
export function AgentInboxOption(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      class="flex items-center gap-3 text-sm"
      checked={props.checked}
      onChange={props.onChange}
      data-agent-inbox-option
    >
      <Checkbox.Control />
      <Checkbox.Label>{t('teamAgents.inboxOption')}</Checkbox.Label>
    </Checkbox>
  );
}
