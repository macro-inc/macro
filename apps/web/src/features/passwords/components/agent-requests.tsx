import { t } from '@app/lib/i18n';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import type { PasswordAgentRevokeScope } from '@service-storage/generated/schemas/passwordAgentRevokeScope';
import type { PasswordPermission } from '@service-storage/generated/schemas/passwordPermission';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { usePasswords } from '../context/passwords-context';
import type {
  AgentRequestFailure,
  AgentRequestSource,
} from '../queries/agent-requests';
import { passwordKeys } from '../queries/keys';

/**
 * Agents waiting for, or holding, access to one item. Only people who can
 * manage the item see it; the server decides who may review, so a refusal
 * hides the section rather than showing controls that cannot work.
 */
export function AgentRequests(props: {
  source: AgentRequestSource;
  itemId: string;
}) {
  const { scope } = usePasswords();
  const queryClient = useQueryClient();
  const key = () =>
    passwordKeys.agentRequests(scope.key, props.itemId).queryKey;
  const states = useQuery(() => ({
    queryKey: key(),
    queryFn: async () => {
      const result = await props.source.forItem(props.itemId);
      // Off, gone or not reviewable: nothing to show.
      if (result.isErr())
        return result.error === 'failed' ? Promise.reject(result.error) : [];
      return result.value;
    },
  }));
  const [busy, setBusy] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const shown = () =>
    (states.data ?? []).filter(
      (state) => state.status === 'pending' || state.access.useBasis !== null
    );

  async function settle(
    work: () => Promise<{ isErr(): boolean; error?: AgentRequestFailure }>
  ) {
    if (busy()) return;
    setBusy(true);
    setStale(false);
    const result = await work();
    if (result.isErr() && result.error === 'stale') setStale(true);
    await queryClient.invalidateQueries({ queryKey: key() });
    setBusy(false);
  }
  const resolve = (
    state: PasswordAgentAccessRequestState,
    decision: PasswordPermission | 'deny'
  ) => {
    const requestId = state.requestId;
    if (!requestId) return;
    fireAndForget(
      settle(() =>
        props.source.resolve(
          props.itemId,
          requestId,
          decision === 'deny'
            ? { decision: 'deny', revision: state.revision }
            : {
                decision: 'approve',
                revision: state.revision,
                permission: decision,
              }
        )
      ),
      'passwords-agent-requests'
    );
  };
  const revoke = (
    state: PasswordAgentAccessRequestState,
    revokeScope: PasswordAgentRevokeScope
  ) =>
    fireAndForget(
      settle(() =>
        props.source.revoke(props.itemId, state.agentAccountId, {
          expectedPermissionRevision: state.access.permissionRevision,
          scope: revokeScope,
        })
      ),
      'passwords-agent-requests'
    );

  return (
    <Show when={shown().length > 0}>
      <section
        aria-label={t('passwords.agentAccess')}
        class="flex flex-col gap-2 border-t border-edge-muted py-3"
      >
        <h3 class="text-xs text-ink-muted">{t('passwords.agentAccess')}</h3>
        <Show when={stale()}>
          <p role="status" class="text-xs text-ink-muted">
            {t('passwords.agentStale')}
          </p>
        </Show>
        <For each={shown()}>
          {(state) => {
            const name = () => getDisplayName(tryMacroId(state.agentAccountId));
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
                        disabled={busy()}
                        aria-label={t('passwords.agentRevoke', {
                          name: name(),
                        })}
                      >
                        {t('passwords.revoke')}
                      </Dropdown.Trigger>
                      <Dropdown.Content>
                        <Show when={state.access.useBasis === 'approved_grant'}>
                          <Dropdown.Item
                            onSelect={() => revoke(state, 'approval')}
                          >
                            {t('passwords.agentRevokeApproval')}
                          </Dropdown.Item>
                        </Show>
                        <Dropdown.Item
                          onSelect={() => revoke(state, 'grant_and_approval')}
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
                    disabled={busy()}
                    onClick={() => resolve(state, 'view')}
                  >
                    {t('passwords.agentAllowView')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy()}
                    onClick={() => resolve(state, 'edit')}
                  >
                    {t('passwords.agentAllowEdit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy()}
                    onClick={() => resolve(state, 'deny')}
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
