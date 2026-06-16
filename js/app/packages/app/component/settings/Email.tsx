import { toast } from '@core/component/Toast/Toast';
import { match } from 'ts-pattern';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_INBOX_RESYNC,
  ENABLE_INBOX_SYNC_STATUS,
  ENABLE_MULTI_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import WideEmailIcon from '@icon/wide-email.svg';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import {
  type Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@core/context/user';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useEmailLinks, useEmailLinksStatus } from '@core/email-link';
import {
  AddInboxDialog,
  openAddInboxDialog,
  useAddInboxGate,
} from '../AddInboxDialog';
import { useRemoveInboxMutation } from '@queries/email/link';
import {
  ConnectionHero,
  IntegrationPanelShell,
  StatusPill,
} from './integration-ui';

export function Email() {
  const email = useEmail();
  const userId = useUserId();
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });
  const guardAddInbox = useAddInboxGate();

  const {
    query: emailLinksQuery,
    connect: connectEmail,
    disconnect: disconnectEmail,
    resyncInbox,
  } = useEmailLinks();
  const emailActive = useEmailLinksStatus();

  const removeInboxMutation = useRemoveInboxMutation({
    onSuccess: () => toast.success('Inbox removed'),
    onError: () => toast.failure('Failed to remove inbox. Please try again.'),
  });
  const [removeTarget, setRemoveTarget] = createSignal<{
    id: string;
    email: string;
    isOwn: boolean;
  } | null>(null);
  const [resyncingIds, setResyncingIds] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const [showDisableDialog, setShowDisableDialog] = createSignal(false);
  const [isEmailActionPending, setIsEmailActionPending] = createSignal(false);

  // The primary inbox is the user's own is_primary link; it sorts to the top
  // and is labelled. Everything else (other own inboxes + delegated/shared) follows.
  const inboxes = createMemo(() => {
    const links = emailLinksQuery.data?.links ?? [];
    const uid = userId();
    const primary = links.find(
      (link) => link.is_primary && link.macro_id === uid
    );
    const others = links.filter((link) => link !== primary);
    return { primary, others };
  });

  const hasAdditionalInboxes = createMemo(() => inboxes().others.length > 0);

  const onConnectEmail = async () => {
    if (isEmailActionPending()) return;
    setIsEmailActionPending(true);
    await connectEmail().match(
      () => {},
      () => toast.failure('Failed to connect email')
    );
    setIsEmailActionPending(false);
  };

  const onDisconnectEmail = async () => {
    if (isEmailActionPending()) return;
    setIsEmailActionPending(true);
    await disconnectEmail().match(
      () => {
        setShowDisableDialog(false);
        toast.success('Email disabled — clearing your data.');
      },
      () => toast.failure('Failed to disable email. Please try again.')
    );
    setIsEmailActionPending(false);
  };

  const handleResyncInbox = async (linkId: string) => {
    setResyncingIds((prev) => new Set(prev).add(linkId));
    await resyncInbox(linkId).match(
      (res) => {
        toast.success(
          res.already_in_progress
            ? 'Sync already in progress'
            : 'Re-sync started'
        );
      },
      () => toast.failure('Failed to start re-sync')
    );
    setResyncingIds((prev) => {
      const next = new Set(prev);
      next.delete(linkId);
      return next;
    });
  };

  const handleRemoveInbox = () => {
    const target = removeTarget();
    if (!target) return;
    setRemoveTarget(null);
    removeInboxMutation.mutate(target.id);
  };

  return (
    <IntegrationPanelShell title="Email">
      <Show
        when={multiInboxFlag().enabled || hasAdditionalInboxes()}
        fallback={
          <ConnectionHero
            icon={WideEmailIcon}
            title="Email"
            description="Connect your Gmail account so Macro can read, organize, and act on your email."
            status={
              <StatusPill
                state={emailActive() ? 'connected' : 'disconnected'}
                label={emailActive() ? 'Connected' : 'Not connected'}
              />
            }
          >
            <Show
              when={emailActive()}
              fallback={
                <Button
                  variant="cta"
                  size="md"
                  depth={3}
                  disabled={isEmailActionPending()}
                  onClick={onConnectEmail}
                >
                  Connect Gmail
                </Button>
              }
            >
              <Button
                variant="base"
                size="md"
                depth={3}
                disabled={isEmailActionPending()}
                onClick={() => setShowDisableDialog(true)}
              >
                Disconnect
              </Button>
            </Show>
          </ConnectionHero>
        }
      >
        <Show
          when={emailActive()}
          fallback={
            <ConnectionHero
              icon={WideEmailIcon}
              title="Email"
              description="Connect your Gmail accounts so Macro can read, organize, and act on your email."
              status={<StatusPill state="disconnected" label="Not connected" />}
            >
              <Button
                variant="cta"
                size="md"
                depth={3}
                disabled={isEmailActionPending()}
                onClick={onConnectEmail}
              >
                Connect Gmail
              </Button>
            </ConnectionHero>
          }
        >
          <div class="px-6 py-8 flex items-center gap-4 border-b border-edge-muted">
            <div class="flex size-11 items-center justify-center rounded-xl bg-edge-muted shrink-0">
              <WideEmailIcon class="size-5 text-ink" />
            </div>
            <div class="flex flex-col gap-1 min-w-0">
              <div class="text-base font-semibold text-ink">
                Connected inboxes
              </div>
              <p class="text-sm text-ink-muted">
                Gmail accounts Macro can read and act on.
              </p>
            </div>
            <Show when={multiInboxFlag().enabled}>
              <Show
                when={!emailLinksQuery.isLoading}
                fallback={
                  <span class="ml-auto text-sm text-ink-muted">Loading…</span>
                }
              >
                <Button
                  variant="active"
                  size="sm"
                  depth={3}
                  class="ml-auto shrink-0"
                  onClick={() => guardAddInbox(openAddInboxDialog)}
                >
                  <PlusIcon class="size-4" />
                  Add inbox
                </Button>
              </Show>
            </Show>
          </div>

          <div class="grid gap-px bg-edge-muted border-b border-edge-muted">
            <Show when={inboxes().primary}>
              {(primary) => (
                <InboxRow
                  link={primary()}
                  isPrimary
                  isOwn={primary().macro_id === userId()}
                  resyncing={resyncingIds().has(primary().id)}
                  onResync={() => handleResyncInbox(primary().id)}
                  onRemove={() =>
                    setRemoveTarget({
                      id: primary().id,
                      email: primary().email_address,
                      isOwn: primary().macro_id === userId(),
                    })
                  }
                />
              )}
            </Show>
            <Show when={!inboxes().primary && email()}>
              <DisabledPrimaryRow
                email={email() ?? ''}
                onEnable={onConnectEmail}
              />
            </Show>
            <For each={inboxes().others}>
              {(link) => (
                <InboxRow
                  link={link}
                  isPrimary={false}
                  isOwn={link.macro_id === userId()}
                  resyncing={resyncingIds().has(link.id)}
                  onResync={() => handleResyncInbox(link.id)}
                  onRemove={() =>
                    setRemoveTarget({
                      id: link.id,
                      email: link.email_address,
                      isOwn: link.macro_id === userId(),
                    })
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <AddInboxDialog />

      <Dialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        position="center"
        class="w-120"
      >
        <Panel active depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <Dialog.Title class="text-ink text-sm font-semibold">
              Remove inbox
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-6 font-sans flex flex-col gap-3">
            <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
              <Show
                when={removeTarget()?.isOwn}
                fallback={
                  <>
                    Remove access to{' '}
                    <span class="text-ink">{removeTarget()?.email}</span>? The
                    inbox and its data stay with its owner.
                  </>
                }
              >
                Remove <span class="text-ink">{removeTarget()?.email}</span>?
                This clears all of its email data from Macro and cannot be
                undone.
              </Show>
            </Dialog.Description>
            <div class="pt-3 justify-end items-center gap-3 inline-flex">
              <Button
                variant="base"
                depth={3}
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </Button>
              <Button variant="danger" depth={3} onClick={handleRemoveInbox}>
                Remove
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>

      <Dialog
        open={showDisableDialog()}
        onOpenChange={setShowDisableDialog}
        position="center"
        class="w-120"
      >
        <Panel active depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <Dialog.Title class="text-ink text-sm font-semibold">
              Disconnect email
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-6 font-sans flex flex-col gap-3">
            <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
              Disconnecting will clear all email data from Macro. This cannot be
              undone.
            </Dialog.Description>
            <div class="pt-3 justify-end items-center gap-3 inline-flex">
              <Button
                variant="base"
                depth={3}
                disabled={isEmailActionPending()}
                onClick={() => setShowDisableDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                depth={3}
                disabled={isEmailActionPending()}
                onClick={onDisconnectEmail}
              >
                Disconnect
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </IntegrationPanelShell>
  );
}

function syncStatusLabel(status: SyncStatus): string {
  return match(status)
    .with(SyncStatus.SYNCING, () => 'Syncing…')
    .with(SyncStatus.UP_TO_DATE, () => 'Up to date')
    .with(SyncStatus.ERROR, () => 'Error — re-sync')
    .with(SyncStatus.INACTIVE, () => 'Disabled')
    .exhaustive();
}

function Chip(props: { label: string }) {
  return (
    <span class="shrink-0 rounded bg-edge-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
      {props.label}
    </span>
  );
}

// Placeholder shown when the account's primary inbox has been removed but other
// inboxes remain. It is not a real link — re-enabling re-runs the Gmail enable
// flow, which re-links and backfills.
function DisabledPrimaryRow(props: { email: string; onEnable: () => void }) {
  return (
    <div class="bg-surface flex items-center justify-between gap-3 h-15.25 px-6">
      <div class="min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture text-sm truncate text-ink-muted">
            {props.email}
          </span>
          <Chip label="Primary" />
          <Chip label="Disabled" />
        </div>
        <span class="text-xs text-ink-muted">Sync disabled</span>
      </div>
      <Button variant="base" size="sm" depth={3} onClick={props.onEnable}>
        Enable
      </Button>
    </div>
  );
}

function InboxRow(props: {
  link: EmailLink;
  isPrimary: boolean;
  isOwn: boolean;
  resyncing: boolean;
  onResync: () => void;
  onRemove: () => void;
}) {
  return (
    <div class="bg-surface flex items-center justify-between gap-3 h-15.25 px-6">
      <div class="min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture text-sm truncate">
            {props.link.email_address}
          </span>
          <Show when={props.isPrimary}>
            <Chip label="Primary" />
          </Show>
          <Show when={!props.isPrimary && !props.isOwn}>
            <Chip label="Shared" />
          </Show>
        </div>
        <Show
          when={
            ENABLE_INBOX_SYNC_STATUS &&
            props.link.sync_status !== SyncStatus.UP_TO_DATE
          }
        >
          <span
            class="flex items-center gap-1 text-xs"
            classList={{
              'text-failure': props.link.sync_status === SyncStatus.ERROR,
              'text-ink-muted': props.link.sync_status !== SyncStatus.ERROR,
            }}
          >
            <Show when={props.link.sync_status === SyncStatus.SYNCING}>
              <ArrowsClockwiseIcon class="size-3 animate-spin" />
            </Show>
            {syncStatusLabel(props.link.sync_status)}
          </span>
        </Show>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Show when={ENABLE_INBOX_RESYNC}>
          <Tooltip label="Force sync">
            <Button
              variant="base"
              size="sm"
              depth={3}
              disabled={
                props.resyncing ||
                (ENABLE_INBOX_SYNC_STATUS &&
                  props.link.sync_status === SyncStatus.SYNCING)
              }
              onClick={props.onResync}
              aria-label={`Force sync ${props.link.email_address}`}
            >
              <ArrowsClockwiseIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
        <Tooltip label="Remove inbox">
          <Button
            variant="base"
            size="sm"
            depth={3}
            onClick={props.onRemove}
            aria-label={`Remove ${props.link.email_address}`}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
