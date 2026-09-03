import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from '@app/features/calendar/components/TurnOffCalendarDialog';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { openAddInboxDialog } from '@app/features/inbox/AddInboxDialog';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_EMAIL_SIGNATURES_FLAG,
  ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  ENABLE_INBOX_RESYNC,
  ENABLE_INBOX_SYNC_STATUS,
  ENABLE_MULTI_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import { useEmail, useUserId } from '@core/context/user';
import {
  useAddInboxFlow,
  useEmailLinks,
  useEmailLinksStatus,
} from '@core/email-link';
import GmailIcon from '@icon/mcp-gmail.svg';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import CalendarSlashIcon from '@phosphor-icons/core/regular/calendar-slash.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import SignatureIcon from '@phosphor-icons/core/regular/signature.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { useRemoveInboxMutation } from '@queries/email/link';
import {
  type Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { InboxSyncStatus } from './inbox-sync-status';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsRow } from './primitives';
import {
  clearSignatureState,
  isSignatureExpanded,
  SignatureSection,
  toggleSignatureExpanded,
} from './SignatureSection';

/**
 * Gmail integration as a single Connected-accounts card: a header row with the
 * connection state/action, and — once connected — a row per inbox plus add /
 * disconnect controls. All the inbox + backfill logic is unchanged; only the
 * surrounding chrome moved from a standalone panel to a shared card.
 */
export function EmailCard() {
  const email = useEmail();
  const userId = useUserId();
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });

  const { query: emailLinksQuery, resyncInbox } = useEmailLinks();
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();

  const removeInboxMutation = useRemoveInboxMutation({
    onSuccess: (_data, linkId) => {
      clearSignatureState(linkId);
      toast.success('Inbox removed');
    },
    onError: () => toast.failure('Failed to remove inbox. Please try again.'),
  });
  const [removeTarget, setRemoveTarget] = createSignal<{
    id: string;
    email: string;
    isOwn: boolean;
  } | null>(null);
  const [turnOffCalendarTarget, setTurnOffCalendarTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);
  const [resyncingIds, setResyncingIds] = createSignal<ReadonlySet<string>>(
    new Set()
  );
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

  const onConnectEmail = async () => {
    if (isEmailActionPending()) return;
    setIsEmailActionPending(true);
    try {
      await startAddInbox();
    } finally {
      setIsEmailActionPending(false);
    }
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
    <>
      <SettingsCard>
        <IntegrationRow
          icon={<GmailIcon />}
          title="Gmail"
          description="Read, organize, and act on your email."
          status={
            <Show when={emailActive()}>
              <StatusDot state="connected" label="Connected" />
            </Show>
          }
        >
          <Show when={!emailActive()}>
            <ConnectAction
              label="Connect"
              onClick={onConnectEmail}
              disabled={isEmailActionPending()}
            />
          </Show>
        </IntegrationRow>

        <Show when={emailActive()}>
          <Show when={inboxes().primary}>
            {(primary) => (
              <InboxRow
                link={primary()}
                isPrimary
                isOwn={primary().macro_id === userId()}
                resyncing={resyncingIds().has(primary().id)}
                onResync={() => handleResyncInbox(primary().id)}
                onReconnect={() => void startAddInbox()}
                onEnableCalendar={() =>
                  void startAddInbox({ scopes: 'calendar' })
                }
                onRemove={() =>
                  setRemoveTarget({
                    id: primary().id,
                    email: primary().email_address,
                    isOwn: primary().macro_id === userId(),
                  })
                }
                onTurnOffCalendar={() =>
                  setTurnOffCalendarTarget({
                    linkId: primary().id,
                    emailAddress: primary().email_address,
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
                onReconnect={() => void startAddInbox()}
                onEnableCalendar={() =>
                  void startAddInbox({ scopes: 'calendar' })
                }
                onRemove={() =>
                  setRemoveTarget({
                    id: link.id,
                    email: link.email_address,
                    isOwn: link.macro_id === userId(),
                  })
                }
                onTurnOffCalendar={() =>
                  setTurnOffCalendarTarget({
                    linkId: link.id,
                    emailAddress: link.email_address,
                  })
                }
              />
            )}
          </For>
          <Show when={multiInboxFlag().enabled}>
            <SettingsRow
              label="Add another inbox"
              description="Connect more Gmail accounts."
            >
              <Tooltip label="Add inbox">
                <Button
                  variant="outline"
                  size="icon-sm"
                  depth={3}
                  aria-label="Add inbox"
                  onClick={openAddInboxDialog}
                >
                  <PlusIcon class="size-4" />
                </Button>
              </Tooltip>
            </SettingsRow>
          </Show>
        </Show>
      </SettingsCard>

      <TurnOffCalendarDialog
        target={turnOffCalendarTarget()}
        onClose={() => setTurnOffCalendarTarget(null)}
      />

      <Dialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        position="center"
        class="w-120"
      >
        <Panel depth={2} class="rounded-xl">
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
                variant="outline"
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
    </>
  );
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
      <Button variant="outline" size="sm" depth={3} onClick={props.onEnable}>
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
  onReconnect: () => void;
  onEnableCalendar: () => void;
  onRemove: () => void;
  onTurnOffCalendar: () => void;
}) {
  const emailSignaturesFlag = useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, {
    enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  });
  const calendarUiEnabled = useCalendarUiFlag();
  const showSignature = () => isSignatureExpanded(props.link.id);
  const signatureSectionId = `signature-section-${props.link.id}`;
  return (
    <div class="bg-surface flex flex-col">
      <div class="flex items-center justify-between gap-3 min-h-15.25 py-2 px-6">
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
          <InboxSyncStatus link={props.link} />
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Show when={emailSignaturesFlag().enabled && props.isOwn}>
            <Tooltip label="Edit signature">
              <Button
                variant="outline"
                size="icon-sm"
                depth={3}
                onClick={() => toggleSignatureExpanded(props.link.id)}
                aria-label={`Edit signature for ${props.link.email_address}`}
                aria-expanded={showSignature()}
                aria-controls={signatureSectionId}
              >
                <SignatureIcon class="size-4" />
              </Button>
            </Tooltip>
          </Show>
          <Show
            when={
              ENABLE_INBOX_SYNC_STATUS &&
              props.link.sync_status === SyncStatus.NEEDS_REAUTH
            }
          >
            <Button
              variant="accent"
              size="sm"
              depth={3}
              onClick={props.onReconnect}
              aria-label={`Reconnect ${props.link.email_address}`}
            >
              Reconnect
            </Button>
          </Show>
          {/* Its own consent flow, since Reconnect asks for the Gmail scopes
              only. Shown alongside Reconnect rather than after it: this
              request is a superset, so one consent repairs a dead grant and
              enables calendar, sparing a full revoke two round trips. */}
          <Show
            when={calendarUiEnabled() && props.link.needs_calendar_permission}
          >
            <Button
              variant="accent"
              size="sm"
              depth={3}
              onClick={props.onEnableCalendar}
              aria-label={`Enable calendar for ${props.link.email_address}`}
            >
              Enable calendar
            </Button>
          </Show>
          {/* Only the owner sees this: turning calendar off deletes the
              inbox's calendar data, which a delegate must not do. Offered
              whenever that data exists, not only while the grant satisfies
              today's capability check — an inbox synced under an earlier scope
              set still has events to remove. */}
          <Show
            when={
              calendarUiEnabled() &&
              props.isOwn &&
              (!props.link.needs_calendar_permission ||
                props.link.has_calendar_data)
            }
          >
            <Tooltip label="Turn off calendar">
              <Button
                variant="outline"
                size="icon-sm"
                depth={3}
                onClick={props.onTurnOffCalendar}
                aria-label={`Turn off calendar for ${props.link.email_address}`}
              >
                <CalendarSlashIcon class="size-4" />
              </Button>
            </Tooltip>
          </Show>
          <Show when={ENABLE_INBOX_RESYNC}>
            <Tooltip label="Force sync">
              <Button
                variant="outline"
                size="icon-sm"
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
              variant="outline"
              size="icon-sm"
              depth={3}
              onClick={props.onRemove}
              aria-label={`Remove ${props.link.email_address}`}
            >
              <XIcon class="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <Show
        when={emailSignaturesFlag().enabled && props.isOwn && showSignature()}
      >
        <div id={signatureSectionId} class="px-6 pb-4">
          <SignatureSection link={props.link} />
        </div>
      </Show>
    </div>
  );
}
