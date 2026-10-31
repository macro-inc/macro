import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from '@app/features/calendar/components/TurnOffCalendarDialog';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_INBOX_RESYNC,
  ENABLE_INBOX_SYNC_STATUS,
  enableMultiInbox,
} from '@core/constant/featureFlags';
import { useEmail, useUserId } from '@core/context/user';
import {
  useAddInboxFlow,
  useEmailLinks,
  useEmailLinksStatus,
} from '@core/email-link';
import {
  calendarConsentScopes,
  reconnectScopes,
} from '@core/email-link/consent';
import type { EmailProvider } from '@core/email-link/ProviderDialog';
import { fireAndForget } from '@core/util/fireAndForget';
import GmailIcon from '@icon/gmail-color.svg';
import OutlookIcon from '@icon/outlook-color.svg';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg?component-solid';
import CalendarSlashIcon from '@icon/system/regular/calendar-slash.svg?component-solid';
import { Telemetry } from '@macro-inc/observability';
import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import {
  type BackfillProgress,
  estimateEtaSeconds,
  getBackfillProgress,
} from '@queries/email/backfill';
import { useRemoveInboxMutation } from '@queries/email/link';
import {
  type Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { cn, Dialog, Panel, Tooltip } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { InboxSettingsOperations } from './InboxSettingsOperations';
import { ConnectAction } from './integration-ui';
import {
  SettingsButton as Button,
  IntegrationRow,
  SettingsSurface,
} from './primitives';
import { clearSignatureState } from './SignatureSection';

/**
 * Starts connecting an inbox. Without a provider, the flow asks which one;
 * Outlook checks that new connections are open first. Repeated clicks while a
 * connection is starting are ignored.
 */
export function useConnectInbox(): (provider?: EmailProvider) => void {
  const startAddInbox = useAddInboxFlow();
  // Not a disabled state: disabling the opener drops focus to <body>, which
  // is where closing the provider chooser would then return it.
  let addingInbox = false;
  const connectEmail = (provider?: EmailProvider) =>
    Telemetry.span('email.link.connect', async (span) => {
      span.setAttr('email.link.provider', provider ?? 'choose');
      try {
        if (provider === 'OUTLOOK' && !(await outlookAvailable())) {
          span.setAttr('email.link.outcome', 'outlook_unavailable');
          toast.failure('New Outlook connections are temporarily unavailable.');
          return;
        }
        await startAddInbox({ provider });
        span.setAttr('email.link.outcome', 'started');
      } finally {
        addingInbox = false;
      }
    });
  return (provider) => {
    if (addingInbox) return;
    addingInbox = true;
    fireAndForget(connectEmail(provider), 'add-inbox');
  };
}

/**
 * Connected inboxes, one row each, followed by rows to connect another Google
 * Workspace or Outlook account.
 */
export function EmailCard(props: { class?: string } = {}) {
  const email = useEmail();
  const userId = useUserId();
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);

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

  // The primary inbox is the user's own is_primary link; it sorts to the top
  // and is labelled. Everything else (other own inboxes + delegated/shared) follows.
  const inboxes = createMemo(() => {
    const links = emailLinksQuery.isSuccess ? emailLinksQuery.data.links : [];
    const uid = userId();
    const primary = links.find(
      (link) => link.is_primary && link.macro_id === uid
    );
    const others = links.filter((link) => link !== primary);
    return { primary, others };
  });

  const onConnectEmail = useConnectInbox();
  const hasInbox = () =>
    Boolean(inboxes().primary) || inboxes().others.length > 0;
  // Further inboxes are behind multi-inbox; the first is always offered.
  const canAddInbox = () => !emailActive() || multiInboxFlag().enabled;

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
      <div class={cn('flex flex-col gap-2', props.class)}>
        <Show when={emailActive()}>
          <Show when={inboxes().primary}>
            {(primary) => (
              <InboxRow
                link={primary()}
                isPrimary
                isOwn={primary().macro_id === userId()}
                resyncing={resyncingIds().has(primary().id)}
                onResync={() => handleResyncInbox(primary().id)}
                onReconnect={() =>
                  fireAndForget(
                    startAddInbox({
                      scopes: reconnectScopes(primary()),
                      provider: primary().provider,
                      reconnectLinkId: primary().id,
                      emailAddress: primary().email_address,
                    }),
                    'add-inbox'
                  )
                }
                onEnableCalendar={() =>
                  fireAndForget(
                    startAddInbox({
                      scopes: calendarConsentScopes(primary()),
                      provider: primary().provider,
                      reconnectLinkId: primary().id,
                      emailAddress: primary().email_address,
                    }),
                    'add-inbox'
                  )
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
              onEnable={() => onConnectEmail()}
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
                onReconnect={() =>
                  fireAndForget(
                    startAddInbox({
                      scopes: reconnectScopes(link),
                      provider: link.provider,
                      reconnectLinkId: link.id,
                      emailAddress: link.email_address,
                    }),
                    'add-inbox'
                  )
                }
                onEnableCalendar={() =>
                  fireAndForget(
                    startAddInbox({
                      scopes: calendarConsentScopes(link),
                      provider: link.provider,
                      reconnectLinkId: link.id,
                      emailAddress: link.email_address,
                    }),
                    'add-inbox'
                  )
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
        </Show>
        <Show when={canAddInbox()}>
          <SettingsSurface>
            <IntegrationRow
              icon={<GmailIcon />}
              title={
                hasInbox()
                  ? 'Connect another Google Workspace account'
                  : 'Connect a Google Workspace account'
              }
              description="Sync a Gmail or Google Workspace inbox into Macro Email."
            >
              <ConnectAction
                label="Connect"
                ariaLabel="Connect a Google Workspace account"
                onClick={() => onConnectEmail('GMAIL')}
              />
            </IntegrationRow>
          </SettingsSurface>
          <SettingsSurface>
            <IntegrationRow
              icon={<OutlookIcon />}
              title="Connect an Outlook account"
              description="Sync an Outlook.com or Microsoft 365 inbox into Macro Email."
            >
              <ConnectAction
                label="Connect"
                ariaLabel="Connect an Outlook account"
                onClick={() => onConnectEmail('OUTLOOK')}
              />
            </IntegrationRow>
          </SettingsSurface>
        </Show>
      </div>

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
              <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={handleRemoveInbox}>
                Remove
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}

/** Whether new Outlook connections are open; the provider chooser checks the same. */
async function outlookAvailable(): Promise<boolean> {
  try {
    return (await fetchEmailConnectionProviders()).outlook;
  } catch {
    return false;
  }
}

function syncStatusLabel(status: SyncStatus): string {
  return match(status)
    .with(SyncStatus.SYNCING, () => 'Syncing…')
    .with(SyncStatus.UP_TO_DATE, () => 'Up to date')
    .with(SyncStatus.ERROR, () => 'Error — re-sync')
    .with(SyncStatus.NEEDS_REAUTH, () => 'Reconnect to resume sync')
    .with(SyncStatus.INACTIVE, () => 'Disabled')
    .exhaustive(() => 'Unknown sync status');
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
    <div class="flex w-60 flex-col gap-2">
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
    <SettingsSurface class="flex flex-wrap items-center justify-between gap-3 min-h-14 px-4 py-3">
      <div class="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ProviderIcon provider="GMAIL" />
        <div class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture text-sm truncate text-ink-muted">
            {props.email}
          </span>
          <Chip label="Primary" />
          <Chip label="Disabled" />
        </div>
        <span class="text-xs text-ink-muted">Sync disabled</span>
      </div>
      <Button variant="secondary" size="md" onClick={props.onEnable}>
        Enable
      </Button>
    </SettingsSurface>
  );
}

function ProviderIcon(props: { provider: EmailLink['provider'] }) {
  return (
    <span
      aria-hidden="true"
      class="flex size-9 shrink-0 items-center justify-center [&_svg]:size-6"
    >
      <Show when={props.provider === 'OUTLOOK'} fallback={<GmailIcon />}>
        <OutlookIcon />
      </Show>
    </span>
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
  const calendarUiEnabled = useCalendarUiFlag();
  return (
    <SettingsSurface class="flex flex-col">
      <div class="flex flex-wrap items-center justify-between gap-3 min-h-14 py-3 px-4">
        <div class="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ProviderIcon provider={props.link.provider} />
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
          <span class="text-xs text-ink-muted">
            {props.link.provider === 'OUTLOOK'
              ? 'Outlook / Microsoft 365'
              : 'Gmail'}
          </span>
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
            </Switch>
          </Show>
        </div>
        <div class="flex max-w-full flex-wrap items-center gap-2 shrink-0">
          <Show when={props.link.needs_reauth}>
            <Button
              variant="primary"
              size="md"
              onClick={props.onReconnect}
              aria-label={`Reconnect ${props.link.email_address}`}
            >
              Reconnect
            </Button>
          </Show>
          {/* Explicitly enabling calendar also restores mailbox access when
              the Google grant has expired. */}
          <Show
            when={calendarUiEnabled() && props.link.needs_calendar_permission}
          >
            <Button
              variant="secondary"
              size="md"
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
                variant="secondary"
                size="icon-sm"
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
                variant="secondary"
                size="icon-sm"
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
              variant="ghost"
              size="md"
              onClick={props.onRemove}
              aria-label={`Remove ${props.link.email_address}`}
            >
              Remove
            </Button>
          </Tooltip>
        </div>
      </div>
      <InboxSettingsOperations linkId={props.link.id} />
    </SettingsSurface>
  );
}
