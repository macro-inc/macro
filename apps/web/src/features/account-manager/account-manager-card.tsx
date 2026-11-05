import { t } from '@app/lib/i18n';
import { CredentialField } from '@channel/Bots/CredentialField';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import XIcon from '@icon/system/regular/x.svg';
import {
  useAccountManagerGrantQuery,
  useClaimAccountManagerTokenMutation,
  useRespondToAccountManagerRequestMutation,
  useRevokeAccountManagerGrantMutation,
} from '@queries/account-managers/account-managers';
import type { AccountManagerGrant } from '@service-storage/generated/schemas/accountManagerGrant';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { match, P } from 'ts-pattern';

/**
 * The card for one account manager request: what happened to it, and what the
 * viewer can do next. Holds the same height in every state, because channels
 * are a virtualized list and a growing message would jump the scroll position.
 */
export function AccountManagerCard(props: { grantId: string }) {
  const grantQuery = useAccountManagerGrantQuery(() => props.grantId);

  return (
    <span class="my-1 flex h-[4.5rem] max-w-md flex-col justify-center gap-1.5 rounded-lg border border-edge-muted bg-panel px-3">
      <Show
        when={grantQuery.data}
        fallback={
          <Show when={grantQuery.isError}>
            <span class="text-sm text-ink-muted">
              {t('accountManager.cardUnavailable')}
            </span>
          </Show>
        }
      >
        {(grant) => <GrantContent grant={grant()} />}
      </Show>
    </span>
  );
}

function GrantContent(props: { grant: AccountManagerGrant }) {
  const userId = useUserId();
  const [confirming, setConfirming] = createSignal(false);
  const [token, setToken] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  const respond = useRespondToAccountManagerRequestMutation();
  const claim = useClaimAccountManagerTokenMutation();
  const revoke = useRevokeAccountManagerGrantMutation();

  const isManager = () => userId() === props.grant.managerUserId;
  const otherName = () => {
    const other = isManager()
      ? props.grant.managedUserId
      : props.grant.managerUserId;
    return getDisplayName(tryMacroId(other));
  };
  const askedByViewer = () =>
    props.grant.requestedBy === (isManager() ? 'manager' : 'managed');
  const busy = () => respond.isPending || claim.isPending || revoke.isPending;

  const title = () => {
    const name = otherName();
    return match([props.grant.status, askedByViewer(), isManager()] as const)
      .with(['pending', true, true], () =>
        t('accountManager.cardOwnRequestManager', { name })
      )
      .with(['pending', true, false], () =>
        t('accountManager.cardOwnRequestManaged', { name })
      )
      .with(['pending', false, true], () =>
        t('accountManager.cardTitleManager', { name })
      )
      .with(['pending', false, false], () =>
        t('accountManager.cardTitleManaged', { name })
      )
      .with(['approved', P._, true], () =>
        t('accountManager.cardApprovedManager', { name })
      )
      .with(['approved', P._, false], () =>
        t('accountManager.cardApprovedManaged', { name })
      )
      .with(['active', P._, true], () =>
        t('accountManager.cardActiveManager', { name })
      )
      .with(['active', P._, false], () =>
        t('accountManager.cardActiveManaged', { name })
      )
      .with(['declined', P._, P._], () => t('accountManager.cardDeclined'))
      .with(['revoked', P._, P._], () => t('accountManager.cardRevoked'))
      .with(['expired', P._, P._], () => t('accountManager.cardExpired'))
      .exhaustive();
  };

  const run = async (action: () => Promise<unknown>) => {
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    }
  };

  const approve = () =>
    run(async () => {
      await respond.mutateAsync({
        id: props.grant.id,
        decision: 'approve',
      });
      setConfirming(false);
    });

  const reveal = () =>
    run(async () => {
      const claimed = await claim.mutateAsync({ id: props.grant.id });
      setToken(claimed.token);
    });

  return (
    <>
      <span class="truncate text-sm font-medium text-ink">{title()}</span>
      <span class="flex items-center gap-1">
        <Show when={failed()}>
          <span class="truncate text-xs text-alert-ink">
            {t('accountManager.actionFailed')}
          </span>
        </Show>
        <Show when={props.grant.status === 'pending' && !askedByViewer()}>
          <Button
            size="sm"
            variant="primary"
            disabled={busy()}
            onClick={() => setConfirming(true)}
          >
            {t('accountManager.approve')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy()}
            onClick={() =>
              run(() =>
                respond.mutateAsync({
                  id: props.grant.id,
                  decision: 'decline',
                })
              )
            }
          >
            {t('accountManager.decline')}
          </Button>
        </Show>
        <Show when={props.grant.status === 'pending' && askedByViewer()}>
          <span class="flex-1 text-xs text-ink-muted">
            {t('accountManager.cardWaiting')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy()}
            onClick={() =>
              run(() => revoke.mutateAsync({ id: props.grant.id }))
            }
          >
            {t('accountManager.withdraw')}
          </Button>
        </Show>
        <Show when={props.grant.status === 'approved' && isManager()}>
          <Button
            size="sm"
            variant="primary"
            disabled={busy()}
            onClick={reveal}
          >
            {t('accountManager.revealToken')}
          </Button>
        </Show>
        <Show
          when={
            props.grant.status === 'active' ||
            (props.grant.status === 'approved' && !isManager())
          }
        >
          <span class="text-xs text-ink-muted">
            {t('accountManager.cardFullAccess')}
          </span>
        </Show>
      </span>

      <Dialog
        open={confirming()}
        onOpenChange={(open) => !open && !busy() && setConfirming(false)}
      >
        <Panel depth={2} class="rounded-xl text-ink">
          <Panel.Header class="gap-1 px-2">
            <Dialog.CloseButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              disabled={busy()}
            >
              <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
              {t('accountManager.confirmTitle')}
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-3 p-3">
            <p class="wrap-anywhere text-sm text-ink-muted">
              {isManager()
                ? t('accountManager.confirmManager', { name: otherName() })
                : t('accountManager.confirmManaged', { name: otherName() })}
            </p>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                disabled={busy()}
                onClick={() => setConfirming(false)}
              >
                {t('accountManager.cancel')}
              </Button>
              <Button variant="primary" disabled={busy()} onClick={approve}>
                {t('accountManager.approve')}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>

      <Dialog
        open={token() !== undefined}
        onOpenChange={(open) => !open && setToken(undefined)}
      >
        <Panel depth={2} class="rounded-xl text-ink">
          <Panel.Header class="gap-1 px-2">
            <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
              {t('accountManager.tokenTitle')}
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-3 p-3">
            <CredentialField
              label={t('accountManager.tokenLabel')}
              value={token() ?? ''}
              help={t('accountManager.tokenHelp')}
            />
            <div class="rounded-lg border border-alert/30 bg-alert-bg px-3 py-2.5 text-xs text-alert-ink">
              {t('accountManager.tokenWarning')}
            </div>
            <div class="flex justify-end pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setToken(undefined)}
              >
                {t('accountManager.done')}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}
