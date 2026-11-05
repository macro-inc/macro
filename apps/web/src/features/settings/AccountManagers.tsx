import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import { getDisplayName, tryMacroId } from '@core/user';
import { formatRelativeTimestamp } from '@entity';
import XIcon from '@icon/system/regular/x.svg';
import {
  useAccountManagersQuery,
  useRevokeAccountManagerGrantMutation,
} from '@queries/account-managers/account-managers';
import type { AccountManagerGrant } from '@service-storage/generated/schemas/accountManagerGrant';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { SettingsCard, SettingsPage } from './primitives';

const managerName = (grant: AccountManagerGrant) =>
  getDisplayName(tryMacroId(grant.managerUserId));

export function AccountManagers() {
  const grantsQuery = useAccountManagersQuery();
  const revoke = useRevokeAccountManagerGrantMutation();
  const [pending, setPending] = createSignal<AccountManagerGrant | null>(null);

  const grants = () => grantsQuery.data ?? [];

  const confirmRevoke = async () => {
    const grant = pending();
    if (!grant) return;

    try {
      await revoke.mutateAsync({ id: grant.id });
      toast.success(t('accountManager.revoked'));
      setPending(null);
    } catch {
      toast.failure(t('accountManager.revokeFailed'));
    }
  };

  return (
    <SettingsPage
      title={t('accountManager.settingsTitle')}
      description={t('accountManager.settingsDescription')}
    >
      <SettingsCard>
        <Show
          when={!grantsQuery.isLoading}
          fallback={
            <div class="flex min-h-36 items-center justify-center">
              <LoadingSpinner class="size-10 p-2" />
            </div>
          }
        >
          <Show
            when={!grantsQuery.isError}
            fallback={
              <div class="px-6 py-8 text-center text-sm text-ink-muted">
                {t('accountManager.settingsLoadFailed')}
              </div>
            }
          >
            <Show
              when={grants().length > 0}
              fallback={
                <div class="px-6 py-8 text-center text-sm text-ink-muted">
                  {t('accountManager.settingsEmpty')}
                </div>
              }
            >
              <For each={grants()}>
                {(grant) => (
                  <div class="flex min-h-14 items-center gap-3 px-6 py-3.5">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-ink">
                        {managerName(grant)}
                      </div>
                      <div class="mt-0.5 text-xs text-ink-extra-muted">
                        {grantDetail(grant)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPending(grant)}
                    >
                      {t('accountManager.revoke')}
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </SettingsCard>

      <Dialog
        open={pending() !== null}
        onOpenChange={(open) => !open && !revoke.isPending && setPending(null)}
      >
        <Panel depth={2} class="rounded-xl text-ink">
          <Panel.Header class="gap-1 px-2">
            <Dialog.CloseButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              disabled={revoke.isPending}
            >
              <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
              {t('accountManager.revokeTitle')}
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-3 p-3">
            <Show when={pending()}>
              {(grant) => (
                <p class="wrap-anywhere text-sm text-ink-muted">
                  {t('accountManager.revokeConfirm', {
                    name: managerName(grant()),
                  })}
                </p>
              )}
            </Show>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => setPending(null)}
              >
                {t('accountManager.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={revoke.isPending}
                onClick={confirmRevoke}
              >
                {t('accountManager.revoke')}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </SettingsPage>
  );
}

function grantDetail(grant: AccountManagerGrant) {
  if (grant.status === 'approved') {
    return t('accountManager.settingsAwaitingClaim');
  }

  if (grant.lastUsedAt) {
    return t('accountManager.settingsLastUsed', {
      time: formatRelativeTimestamp(grant.lastUsedAt),
    });
  }

  if (grant.claimedAt) {
    return t('accountManager.settingsGranted', {
      time: formatRelativeTimestamp(grant.claimedAt),
    });
  }

  return t('accountManager.settingsNeverUsed');
}
