import { t } from '@app/lib/i18n';
import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import type { PasswordAgentRevokeScope } from '@service-storage/generated/schemas/passwordAgentRevokeScope';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { AgentRequestDecision } from '../core/types';

/**
 * Agents waiting for, or holding, access to one item. Renders nothing without
 * states, so a refusal to list them hides the section rather than showing
 * controls that cannot work.
 */
export function AgentRequests(props: {
  states: PasswordAgentAccessRequestState[];
  nameOf: (agentAccountId: string) => string;
  busy: boolean;
  /** The last decision answered a request that had since changed. */
  stale: boolean;
  /** The last decision did not go through; the controls stay to retry. */
  failed: boolean;
  onResolve: (
    state: PasswordAgentAccessRequestState,
    decision: AgentRequestDecision
  ) => void;
  onRevoke: (
    state: PasswordAgentAccessRequestState,
    scope: PasswordAgentRevokeScope
  ) => void;
}) {
  return (
    <Show when={props.states.length > 0}>
      <section
        aria-label={t('passwords.agentAccess')}
        class="flex flex-col gap-2 border-t border-edge-muted py-3"
      >
        <h3 class="text-xs text-ink-muted">{t('passwords.agentAccess')}</h3>
        <Show when={props.stale}>
          <p role="status" class="text-xs text-ink-muted">
            {t('passwords.agentStale')}
          </p>
        </Show>
        <Show when={props.failed}>
          <p role="alert" class="text-xs text-failure-ink">
            {t('passwords.agentActionFailed')}
          </p>
        </Show>
        <For each={props.states}>
          {(state) => {
            const name = () => props.nameOf(state.agentAccountId);
            return (
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="min-w-0 flex-1">
                  {state.status === 'pending'
                    ? t(
                        `passwords.agentRequested_${state.permission ?? 'view'}`,
                        {
                          name: name(),
                        }
                      )
                    : state.access.useBasis === 'creator_grant'
                      ? t('passwords.agentCreator', { name: name() })
                      : t(
                          `passwords.agentCanUse_${state.access.canUpdate ? 'edit' : 'view'}`,
                          { name: name() }
                        )}
                </span>
                <Show
                  when={state.status === 'pending'}
                  fallback={
                    <Dropdown placement="bottom-end">
                      <Dropdown.Trigger
                        variant="secondary"
                        size="sm"
                        disabled={props.busy}
                        aria-label={t('passwords.agentRevoke', {
                          name: name(),
                        })}
                      >
                        {t('passwords.revoke')}
                      </Dropdown.Trigger>
                      <Dropdown.Content>
                        <Show when={state.access.useBasis === 'approved_grant'}>
                          <Dropdown.Item
                            onSelect={() => props.onRevoke(state, 'approval')}
                          >
                            {t('passwords.agentRevokeApproval')}
                          </Dropdown.Item>
                        </Show>
                        <Dropdown.Item
                          onSelect={() =>
                            props.onRevoke(state, 'grant_and_approval')
                          }
                        >
                          {t('passwords.agentRevokeGrant')}
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onResolve(state, 'view')}
                  >
                    {t('passwords.agentAllowView')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onResolve(state, 'edit')}
                  >
                    {t('passwords.agentAllowEdit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onResolve(state, 'deny')}
                  >
                    {t('passwords.agentDeny')}
                  </Button>
                </Show>
              </div>
            );
          }}
        </For>
      </section>
    </Show>
  );
}
