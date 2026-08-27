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
import CalendarIcon from '@phosphor-icons/core/regular/calendar-blank.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import SignatureIcon from '@phosphor-icons/core/regular/signature.svg?component-solid';
import TrashIcon from '@phosphor-icons/core/regular/trash.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import {
  type BackfillProgress,
  estimateEtaSeconds,
  getBackfillProgress,
  useBackfillJobsQuery,
} from '@queries/email/backfill';
import {
  useEmailSignature,
  useRemoveInboxMutation,
} from '@queries/email/link';
import {
  type BackfillJob,
  BackfillJobStatus,
  type Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { Button, cn, Dialog, Panel, ToggleSwitch, Tooltip } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsRow } from './primitives';
import {
  clearSignatureState,
  SignatureSection,
} from './SignatureSection';

/**
 * Gmail integration as a single Connected-accounts card: a header row with the
 * connection state/action, and — once connected — a row per inbox plus add /
 * disconnect controls. All the inbox + backfill logic is unchanged; only the
 * surrounding chrome moved from a standalone panel to a shared card.
 */
export function EmailCard(props: { embedded?: boolean } = {}) {
  const email = useEmail();
  const userId = useUserId();
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });

  const { query: emailLinksQuery, resyncInbox } = useEmailLinks();
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  const [signatureTarget, setSignatureTarget] =
    createSignal<EmailLink | null>(null);
  const selectedSignature = useEmailSignature(() => signatureTarget()?.id);

  // Fires when the Email settings open. Used only to surface the COMPLETED
  // state; in-progress state comes from the live connection-gateway store.
  const backfillJobsQuery = useBackfillJobsQuery();
  // Latest job per link. The query returns newest-first, so the first job seen
  // for a link_id is its latest — we key the settled label off the current job,
  // not any historical completed one (a later fail/cancel must not still read
  // as "complete").
  const latestBackfillByLinkId = createMemo(() => {
    const latest = new Map<string, BackfillJob>();
    for (const job of backfillJobsQuery.data?.jobs ?? []) {
      if (job.link_id && !latest.has(job.link_id)) {
        latest.set(job.link_id, job);
      }
    }
    return latest;
  });
  const hasCompletedBackfill = (linkId: string): boolean =>
    latestBackfillByLinkId().get(linkId)?.status === BackfillJobStatus.Complete;

  const removeInboxMutation = useRemoveInboxMutation({
    onSuccess: (_data, linkId) => {
      clearSignatureState(linkId);
      if (signatureTarget()?.id === linkId) setSignatureTarget(null);
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
      <SettingsCard
        unstyled={props.embedded}
        class={props.embedded ? 'flex flex-col gap-4' : undefined}
      >
        <Show when={!props.embedded || !emailActive()}>
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
                large={props.embedded}
              />
            </Show>
          </IntegrationRow>
        </Show>

        <Show when={emailActive()}>
          <Show when={inboxes().primary}>
            {(primary) => (
              <InboxRow
                link={primary()}
                isPrimary
                isOwn={primary().macro_id === userId()}
                compact={props.embedded}
                hasCompletedBackfill={hasCompletedBackfill(primary().id)}
                resyncing={resyncingIds().has(primary().id)}
                onResync={() => handleResyncInbox(primary().id)}
                onEditSignature={() => setSignatureTarget(primary())}
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
              compact={props.embedded}
              onEnable={onConnectEmail}
            />
          </Show>
          <For each={inboxes().others}>
            {(link) => (
              <InboxRow
                link={link}
                isPrimary={false}
                isOwn={link.macro_id === userId()}
                compact={props.embedded}
                hasCompletedBackfill={hasCompletedBackfill(link.id)}
                resyncing={resyncingIds().has(link.id)}
                onResync={() => handleResyncInbox(link.id)}
                onEditSignature={() => setSignatureTarget(link)}
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
            <Show
              when={props.embedded}
              fallback={
                <SettingsRow
                  label="Add another inbox"
                  description="Connect more Gmail accounts."
                >
                  <Tooltip label="Add inbox">
                    <Button
                      variant="base"
                      size="icon-sm"
                      depth={3}
                      aria-label="Add inbox"
                      onClick={openAddInboxDialog}
                    >
                      <PlusIcon class="size-4" />
                    </Button>
                  </Tooltip>
                </SettingsRow>
              }
            >
              <div class="pt-1">
                <Button
                  variant="cta"
                  size="md"
                  fullWidth
                  class="h-9 rounded-full"
                  onClick={openAddInboxDialog}
                >
                  <PlusIcon class="size-4" />
                  Add another inbox
                </Button>
              </div>
            </Show>
          </Show>
        </Show>
      </SettingsCard>

      <TurnOffCalendarDialog
        target={turnOffCalendarTarget()}
        onClose={() => setTurnOffCalendarTarget(null)}
      />

      <Dialog
        open={signatureTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setSignatureTarget(null);
        }}
        position="center"
        visibleScrim
        animate
        class="w-[min(42rem,calc(100vw-2rem))]"
      >
        <Panel depth={2} class="rounded-2xl">
          <Panel.Header class="px-5">
            <div class="flex w-full min-w-0 items-center justify-between gap-3">
              <Dialog.Title class="text-base font-semibold text-ink">
                {selectedSignature()?.trim()
                  ? 'Edit signature'
                  : 'Add signature'}
              </Dialog.Title>
              <Button
                variant="ghost"
                size="icon-sm"
                class="shrink-0 rounded-full"
                label="Close signature editor"
                aria-label="Close signature editor"
                onClick={() => setSignatureTarget(null)}
              >
                <XIcon class="size-4" />
              </Button>
            </div>
          </Panel.Header>
          <Panel.Body class="p-5">
            <Show when={signatureTarget()}>
              {(link) => (
                <div class="flex flex-col gap-4">
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-ink-extra-muted">
                      Inbox
                    </p>
                    <p class="ph-no-capture mt-1 truncate text-sm text-ink">
                      {link().email_address}
                    </p>
                  </div>
                  <SignatureSection
                    link={link()}
                    embedded
                    onSaved={() => setSignatureTarget(null)}
                  />
                </div>
              )}
            </Show>
          </Panel.Body>
        </Panel>
      </Dialog>

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
    </>
  );
}

function syncStatusLabel(status: SyncStatus): string {
  return match(status)
    .with(SyncStatus.SYNCING, () => 'Syncing…')
    .with(SyncStatus.UP_TO_DATE, () => 'Up to date')
    .with(SyncStatus.ERROR, () => 'Error — re-sync')
    .with(SyncStatus.NEEDS_REAUTH, () => 'Reconnect to resume sync')
    .with(SyncStatus.INACTIVE, () => 'Disabled')
    .exhaustive();
}

// Live backfill progress bar. `completed`/`total` are the connection-gateway
// counters; render the ratio rather than the raw counts since the priority pass
// can inflate both slightly above the real mailbox size.
// Rough "time left" from the recent backfill rate. Rounds up and bins into
// s / m / h so the estimate doesn't visibly jitter between progress events.
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `~${hours}h ${remMinutes}m left` : `~${hours}h left`;
}

function BackfillProgressBar(props: { progress: BackfillProgress }) {
  const percent = () => {
    if (props.progress.total <= 0) return 0;
    // Only reach 100% at actual completion; floor otherwise so e.g. 999/1000
    // doesn't round up and make the bar look finished early.
    if (props.progress.completed >= props.progress.total) return 100;
    return Math.floor((props.progress.completed / props.progress.total) * 100);
  };
  const etaLabel = createMemo(() => {
    const seconds = estimateEtaSeconds(props.progress);
    return seconds === undefined ? undefined : formatEta(seconds);
  });
  return (
    <div class="flex w-full flex-col gap-2">
      <span class="flex items-center gap-1.5 text-xs text-ink-muted">
        <ArrowsClockwiseIcon class="size-3 shrink-0 animate-spin" />
        Backfilling…
      </span>
      <div class="flex items-center gap-6 whitespace-nowrap text-xs text-ink-muted">
        <span>
          {props.progress.completed.toLocaleString()} of{' '}
          {props.progress.total.toLocaleString()} threads
        </span>
        <Show when={etaLabel()}>{(label) => <span>{label()}</span>}</Show>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-full bg-edge-muted">
        <div
          class="h-full rounded-full bg-ink transition-[width] duration-300"
          style={{ width: `${percent()}%` }}
        />
      </div>
    </div>
  );
}

function CompletedBackfillProgressBar() {
  return (
    <div class="flex w-full flex-col gap-2">
      <div class="flex items-center justify-between text-xs">
        <span class="text-ink-muted">Sync complete</span>
        <span class="font-medium text-success">100%</span>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-full bg-success/15">
        <div class="h-full w-full rounded-full bg-success" />
      </div>
    </div>
  );
}

function Chip(props: { label: string }) {
  return (
    <span class="user-select-none inline-flex shrink-0 items-center rounded-full border border-edge-muted bg-ink/8 px-2 py-0.5 font-mono text-xxs font-medium uppercase text-ink-muted">
      {props.label}
    </span>
  );
}

// Placeholder shown when the account's primary inbox has been removed but other
// inboxes remain. It is not a real link — re-enabling re-runs the Gmail enable
// flow, which re-links and backfills.
function DisabledPrimaryRow(props: {
  email: string;
  compact?: boolean;
  onEnable: () => void;
}) {
  return (
    <div
      class={cn(
        'flex items-center justify-between gap-3',
        props.compact
          ? 'rounded-xl bg-lift p-4'
          : 'h-15.25 bg-surface px-6'
      )}
    >
      <div
        class={cn(
          'flex min-w-0 flex-col gap-0.5',
          props.compact && 'flex-1'
        )}
      >
        <div
          class={cn(
            'flex w-full min-w-0 items-center',
            props.compact ? 'flex-wrap gap-1.5' : 'gap-2'
          )}
        >
          <span
            class={cn(
              'ph-no-capture min-w-0 truncate text-sm text-ink-muted',
              props.compact && 'flex-1 text-base font-medium'
            )}
          >
            {props.email}
          </span>
          <div
            class={cn(
              'flex shrink-0 items-center gap-1',
              props.compact && 'order-first w-full'
            )}
          >
            <Chip label="Primary" />
            <Chip label="Disabled" />
          </div>
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
  compact?: boolean;
  hasCompletedBackfill: boolean;
  resyncing: boolean;
  onResync: () => void;
  onEditSignature: () => void;
  onReconnect: () => void;
  onEnableCalendar: () => void;
  onRemove: () => void;
  onTurnOffCalendar: () => void;
}) {
  const emailSignaturesFlag = useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, {
    enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  });
  const signature = useEmailSignature(() => props.link.id);
  const hasSignature = () => Boolean(signature()?.trim());
  const signatureActionLabel = () =>
    hasSignature() ? 'Edit signature' : 'Add signature';
  const calendarUiEnabled = useCalendarUiFlag();
  const hasSignatureAction = () =>
    emailSignaturesFlag().enabled && props.isOwn;
  const hasCalendarAction = () => calendarUiEnabled() && props.isOwn;
  const calendarEnabled = () =>
    !props.link.needs_calendar_permission || props.link.has_calendar_data;
  const needsReconnect = () =>
    ENABLE_INBOX_SYNC_STATUS &&
    props.link.sync_status === SyncStatus.NEEDS_REAUTH;
  const hasInlineActions = () => !props.compact;
  const hasCompactActions = () =>
    Boolean(props.compact) &&
    (needsReconnect() ||
      ENABLE_INBOX_RESYNC ||
      hasCalendarAction() ||
      hasSignatureAction());
  return (
    <div
      class={cn(
        'flex flex-col',
        props.compact
          ? 'relative gap-4 overflow-hidden rounded-xl bg-lift p-4'
          : 'bg-surface'
      )}
    >
      <div
        class={cn(
          'flex gap-3 py-2',
          props.compact
            ? 'flex-col items-stretch p-0'
            : 'min-h-15.25 items-center justify-between px-6'
        )}
      >
        <div
          class={cn(
            'flex min-w-0 flex-col',
            props.compact ? 'gap-2' : 'gap-0.5'
          )}
        >
          <Show
            when={props.compact}
            fallback={
              <div class="flex w-full min-w-0 items-center gap-2">
                <span class="ph-no-capture min-w-0 truncate text-sm">
                  {props.link.email_address}
                </span>
                <div class="flex shrink-0 items-center gap-1">
                  <Show when={props.isPrimary}>
                    <Chip label="Primary" />
                  </Show>
                  <Show when={!props.isPrimary && !props.isOwn}>
                    <Chip label="Shared" />
                  </Show>
                </div>
              </div>
            }
          >
            <div class="flex w-full items-center gap-3 pr-10">
              <div class="flex min-w-0 items-center gap-1">
                <Show when={props.isPrimary}>
                  <Chip label="Primary" />
                </Show>
                <Show when={!props.isPrimary && props.isOwn}>
                  <Chip label="Secondary" />
                </Show>
                <Show when={!props.isPrimary && !props.isOwn}>
                  <Chip label="Shared" />
                </Show>
              </div>
              <Button
                variant="danger"
                size="icon-md"
                class="absolute right-3 top-3 rounded-full bg-transparent! not-disabled:hover:bg-failure/10! dark:bg-transparent! dark:not-disabled:hover:bg-failure/15! [&_svg]:size-4!"
                tooltip="Remove inbox"
                onClick={props.onRemove}
                aria-label={`Remove ${props.link.email_address}`}
              >
                <TrashIcon class="size-4" />
              </Button>
            </div>
            <span class="ph-no-capture min-w-0 truncate text-base font-medium">
              {props.link.email_address}
            </span>
          </Show>
          <Show when={ENABLE_INBOX_SYNC_STATUS}>
            <Switch
              fallback={
                <Show when={props.link.sync_status !== SyncStatus.UP_TO_DATE}>
                  <span
                    class="flex items-center gap-1 text-xs"
                    classList={{
                      'text-failure':
                        props.link.sync_status === SyncStatus.ERROR ||
                        props.link.sync_status === SyncStatus.NEEDS_REAUTH,
                      'text-ink-muted':
                        props.link.sync_status !== SyncStatus.ERROR &&
                        props.link.sync_status !== SyncStatus.NEEDS_REAUTH,
                    }}
                  >
                    <Show when={props.link.sync_status === SyncStatus.SYNCING}>
                      <ArrowsClockwiseIcon class="size-3 animate-spin" />
                    </Show>
                    {syncStatusLabel(props.link.sync_status)}
                  </span>
                </Show>
              }
            >
              {/* Live backfill progress (connection gateway) wins over the coarse
                  sync_status while a backfill is actively running. */}
              <Match when={getBackfillProgress(props.link.id)}>
                {(progress) => <BackfillProgressBar progress={progress()} />}
              </Match>
              {/* Keep the completed backfill visible as a settled 100% bar. */}
              <Match
                when={
                  props.link.sync_status === SyncStatus.UP_TO_DATE &&
                  props.hasCompletedBackfill
                }
              >
                <CompletedBackfillProgressBar />
              </Match>
            </Switch>
          </Show>
        </div>
        <Show when={hasInlineActions()}>
          <div
            class={cn(
              'flex shrink-0 items-center gap-2',
              props.compact && 'flex-wrap justify-end'
            )}
          >
          <Show
            when={
              emailSignaturesFlag().enabled && props.isOwn && !props.compact
            }
          >
            <Tooltip label={signatureActionLabel()}>
              <Button
                variant="base"
                size="icon-sm"
                depth={3}
                onClick={props.onEditSignature}
                aria-label={`${signatureActionLabel()} for ${props.link.email_address}`}
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
              variant="active"
              size="sm"
              depth={3}
              onClick={props.onReconnect}
              aria-label={`Reconnect ${props.link.email_address}`}
            >
              Reconnect
            </Button>
          </Show>
          <Show when={hasCalendarAction() && !props.compact}>
            <div
              class={cn(
                'flex items-center gap-3 rounded-lg py-1 text-xs text-ink-muted',
                props.compact && 'w-full justify-between'
              )}
            >
              <span>Calendar</span>
              <ToggleSwitch
                size="md"
                checked={calendarEnabled()}
                label="Calendar sync"
                labelClass="sr-only"
                onChange={(enabled) =>
                  enabled
                    ? props.onEnableCalendar()
                    : props.onTurnOffCalendar()
                }
              />
            </div>
          </Show>
          <Show when={ENABLE_INBOX_RESYNC}>
            <Tooltip label="Force sync">
              <Button
                variant="base"
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
          <Show when={!props.compact}>
            <Tooltip label="Remove inbox">
              <Button
                variant="base"
                size="icon-sm"
                depth={3}
                onClick={props.onRemove}
                aria-label={`Remove ${props.link.email_address}`}
              >
                <XIcon class="size-4" />
              </Button>
            </Tooltip>
          </Show>
          </div>
        </Show>
      </div>
      <Show when={hasCompactActions()}>
        <div class="flex flex-col gap-2">
          <Show when={needsReconnect()}>
            <Button
              variant="active"
              size="md"
              fullWidth
              class="h-9 rounded-full"
              onClick={props.onReconnect}
            >
              Reconnect
            </Button>
          </Show>
          <Show when={ENABLE_INBOX_RESYNC}>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              class="h-9 rounded-full bg-ink/8 text-ink hover:bg-ink/12"
              disabled={
                props.resyncing ||
                (ENABLE_INBOX_SYNC_STATUS &&
                  props.link.sync_status === SyncStatus.SYNCING)
              }
              onClick={props.onResync}
            >
              <ArrowsClockwiseIcon class="size-4" />
              Force sync
            </Button>
          </Show>
          <Show when={hasCalendarAction()}>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              class={cn(
                'h-9 rounded-full text-ink',
                calendarEnabled()
                  ? 'bg-active hover:bg-active'
                  : 'bg-ink/8 hover:bg-ink/12'
              )}
              aria-pressed={calendarEnabled()}
              onClick={() =>
                calendarEnabled()
                  ? props.onTurnOffCalendar()
                  : props.onEnableCalendar()
              }
            >
              <CalendarIcon class="size-4" />
              {calendarEnabled() ? 'Turn off calendar' : 'Turn on calendar'}
            </Button>
          </Show>
          <Show when={hasSignatureAction()}>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              class="h-9 rounded-full bg-ink/8 text-ink hover:bg-ink/12"
              onClick={props.onEditSignature}
            >
              <SignatureIcon class="size-4" />
              {signatureActionLabel()}
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
