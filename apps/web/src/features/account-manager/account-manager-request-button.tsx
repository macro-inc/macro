import { t } from '@app/lib/i18n';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName, isAgentAccount, tryMacroId } from '@core/user';
import UserGearIcon from '@icon/system/regular/user-gear.svg';
import XIcon from '@icon/system/regular/x.svg';
import { useRequestAccountManagerMutation } from '@queries/account-managers/account-managers';
import type { AccountManagerRole } from '@service-storage/generated/schemas/accountManagerRole';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';

/**
 * Starts an account manager request from a DM, when one side is an agent
 * account: the manager is always an agent.
 */
export function AccountManagerRequestButton(props: { channelId: string }) {
  const userId = useUserId();
  const participants = useChannelParticipants(() => props.channelId);
  const request = useRequestAccountManagerMutation();
  const [open, setOpen] = createSignal(false);

  const counterparty = () => participants.ids().find((id) => id !== userId());
  const counterpartyMacroId = () => {
    const id = counterparty();
    return id ? tryMacroId(id) : undefined;
  };
  const counterpartyName = () => getDisplayName(counterpartyMacroId());
  const counterpartyIsAgent = () => isAgentAccount(counterpartyMacroId());
  const viewerIsAgent = () => {
    const id = userId();
    return id ? isAgentAccount(tryMacroId(id)) : false;
  };

  const ask = async (callerRole: AccountManagerRole) => {
    const counterpartyId = counterparty();
    if (!counterpartyId) return;

    try {
      await request.mutateAsync({ counterpartyId, callerRole });
      toast.success(t('accountManager.requestSent'));
      setOpen(false);
    } catch {
      toast.failure(t('accountManager.requestFailed'));
    }
  };

  return (
    <Show when={counterparty() && (counterpartyIsAgent() || viewerIsAgent())}>
      <Button
        size="icon-sm"
        variant="ghost"
        tooltip={t('accountManager.requestAction')}
        aria-label={t('accountManager.requestAction')}
        onClick={() => setOpen(true)}
      >
        <UserGearIcon class="size-4 shrink-0" />
      </Button>
      <Dialog
        open={open()}
        onOpenChange={(next) => !next && !request.isPending && setOpen(false)}
      >
        <Panel depth={2} class="rounded-xl text-ink">
          <Panel.Header class="gap-1 px-2">
            <Dialog.CloseButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              disabled={request.isPending}
            >
              <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
              {t('accountManager.requestDialogTitle')}
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-4 p-3">
            <Show when={counterpartyIsAgent()}>
              <div class="flex flex-col items-start gap-2">
                <p class="wrap-anywhere text-sm text-ink-muted">
                  {t('accountManager.askToBeManagedWarning', {
                    name: counterpartyName(),
                  })}
                </p>
                <Button
                  class="h-auto max-w-full wrap-anywhere whitespace-normal text-left"
                  variant="primary"
                  disabled={request.isPending}
                  onClick={() => ask('managed')}
                >
                  {t('accountManager.askToBeManaged', {
                    name: counterpartyName(),
                  })}
                </Button>
              </div>
            </Show>
            <Show when={viewerIsAgent()}>
              <div class="flex flex-col items-start gap-2">
                <p class="wrap-anywhere text-sm text-ink-muted">
                  {t('accountManager.askToManageWarning', {
                    name: counterpartyName(),
                  })}
                </p>
                <Button
                  class="h-auto max-w-full wrap-anywhere whitespace-normal text-left"
                  variant="primary"
                  disabled={request.isPending}
                  onClick={() => ask('manager')}
                >
                  {t('accountManager.askToManage', {
                    name: counterpartyName(),
                  })}
                </Button>
              </div>
            </Show>
          </Panel.Body>
        </Panel>
      </Dialog>
    </Show>
  );
}
