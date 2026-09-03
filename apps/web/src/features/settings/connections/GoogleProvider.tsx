import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from '@app/features/calendar/components/TurnOffCalendarDialog';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_EMAIL_SIGNATURES_FLAG,
  ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  ENABLE_MULTI_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import { useEmail, useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import {
  useEmailLinksQuery,
  useRemoveInboxMutation,
} from '@queries/email/link';
import type { ConsentScopes } from '@service-auth/client';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { InboxSyncStatus } from '../inbox-sync-status';
import { ConnectAction } from '../integration-ui';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import {
  clearSignatureState,
  isSignatureExpanded,
  SignatureSection,
  toggleSignatureExpanded,
} from '../SignatureSection';
import { CapabilityRow } from './capability-row';
import { ConnectionRowActions } from './connection-more';
import {
  type Capability,
  type ConnectionsModel,
  capabilitiesFor,
} from './model';
import { providerIcon } from './provider-meta';
import { closeConnectionsProvider } from './view-state';

export function GoogleProvider(props: { model: ConnectionsModel }) {
  const userId = useUserId();
  const accountEmail = useEmail();
  const rows = () => capabilitiesFor(props.model, 'google');
  const inboxes = () => {
    const emails = [...new Set(rows().map((row) => row.account))];
    return emails.map((email) => ({
      email,
      scope: rows().find((row) => row.account === email)?.scope ?? 'personal',
      caps: rows().filter((row) => row.account === email),
    }));
  };

  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });
  const startAddInbox = useAddInboxFlow();
  const emailLinks = useEmailLinksQuery();
  const linkById = (id: string | undefined): EmailLink | undefined =>
    id ? emailLinks.data?.links.find((link) => link.id === id) : undefined;
  const removeInbox = useRemoveInboxMutation({
    onSuccess: (_data, linkId) => {
      clearSignatureState(linkId);
      toast.success('Inbox removed');
    },
    onError: () => toast.failure('Failed to remove inbox. Please try again.'),
  });
  const [pending, setPending] = createSignal(false);
  const [calendarTarget, setCalendarTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);
  const [removeTarget, setRemoveTarget] = createSignal<{
    id: string;
    email: string;
    isOwn: boolean;
  } | null>(null);

  const connect = async (scopes?: ConsentScopes) => {
    if (pending()) return;
    setPending(true);
    try {
      await startAddInbox(scopes ? { scopes } : undefined);
    } finally {
      setPending(false);
    }
  };

  const linkIdFor = (capability: Capability) =>
    capability.id.startsWith('gmail:') || capability.id.startsWith('calendar:')
      ? capability.id.slice(capability.id.indexOf(':') + 1)
      : undefined;

  const disabledPrimaryEmail = () => {
    const email = accountEmail();
    if (!email) return undefined;
    const links = emailLinks.data?.links ?? [];
    const hasPrimary = links.some(
      (link) => link.is_primary && link.macro_id === userId()
    );
    if (hasPrimary || links.length === 0) return undefined;
    return email;
  };

  return (
    <SettingsPage
      title="Google"
      icon={providerIcon('google')}
      onBack={closeConnectionsProvider}
    >
      <Show
        when={inboxes().length > 0}
        fallback={
          <SettingsSection title="Your Connections">
            <SettingsCard>
              <CapabilityRow
                title="Gmail"
                outcome="Read, organize, and act on your email."
              >
                <ConnectAction
                  label="Connect"
                  onClick={() => void connect()}
                  disabled={pending()}
                />
              </CapabilityRow>
            </SettingsCard>
          </SettingsSection>
        }
      >
        <For each={inboxes()}>
          {(inbox) => (
            <SettingsSection
              title={<span class="ph-no-capture truncate">{inbox.email}</span>}
              description={inbox.scope === 'shared' ? 'Shared' : undefined}
            >
              <SettingsCard>
                <For each={inbox.caps}>
                  {(row) => (
                    <GoogleInboxCapability
                      row={row}
                      link={linkById(linkIdFor(row))}
                      pending={pending()}
                      removing={removeInbox.isPending}
                      onConnect={() =>
                        void connect(
                          row.id.startsWith('calendar:') ? 'calendar' : 'gmail'
                        )
                      }
                      onReconnect={() => void connect()}
                      onRemoveGmail={() => {
                        const linkId = linkIdFor(row);
                        if (!linkId) return;
                        setRemoveTarget({
                          id: linkId,
                          email: row.account,
                          isOwn: row.scope === 'personal',
                        });
                      }}
                      onTurnOffCalendar={() => {
                        const linkId = linkIdFor(row);
                        if (!linkId) return;
                        setCalendarTarget({
                          linkId,
                          emailAddress: row.account,
                        });
                      }}
                    />
                  )}
                </For>
              </SettingsCard>
            </SettingsSection>
          )}
        </For>
        <Show when={disabledPrimaryEmail()}>
          {(email) => (
            <SettingsSection
              title={<span class="ph-no-capture truncate">{email()}</span>}
            >
              <SettingsCard>
                <CapabilityRow
                  title="Gmail"
                  outcome="Sync disabled"
                  facts="Primary · Disabled"
                >
                  <ConnectAction
                    label="Enable"
                    onClick={() => void connect()}
                    disabled={pending()}
                  />
                </CapabilityRow>
              </SettingsCard>
            </SettingsSection>
          )}
        </Show>
      </Show>

      <Show when={rows().length > 0 && multiInboxFlag().enabled}>
        <ConnectAction
          label="Add another Google account"
          onClick={() => void connect()}
          disabled={pending()}
        />
      </Show>

      <TurnOffCalendarDialog
        target={calendarTarget()}
        onClose={() => setCalendarTarget(null)}
      />

      <Dialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        position="center"
        visibleScrim
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
                    <span class="ph-no-capture text-ink">
                      {removeTarget()?.email}
                    </span>
                    ? The inbox and its data stay with its owner.
                  </>
                }
              >
                Remove{' '}
                <span class="ph-no-capture text-ink">
                  {removeTarget()?.email}
                </span>
                ? This clears all of its email data from Macro and cannot be
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
              <Button
                variant="danger"
                depth={3}
                onClick={() => {
                  const target = removeTarget();
                  if (!target) return;
                  setRemoveTarget(null);
                  removeInbox.mutate(target.id);
                }}
              >
                Remove
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </SettingsPage>
  );
}

function GoogleInboxCapability(props: {
  row: Capability;
  link: EmailLink | undefined;
  pending: boolean;
  removing: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onRemoveGmail: () => void;
  onTurnOffCalendar: () => void;
}) {
  const signaturesFlag = useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, {
    enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  });
  const isGmail = () => props.row.id.startsWith('gmail:');
  const isOwn = () => props.row.scope === 'personal';
  const showSignature = () =>
    Boolean(
      props.link &&
        isGmail() &&
        isOwn() &&
        signaturesFlag().enabled &&
        isSignatureExpanded(props.link.id)
    );
  const signatureSectionId = () =>
    props.link ? `signature-section-${props.link.id}` : undefined;

  const capabilityRow = () => (
    <CapabilityRow
      title={props.row.title}
      outcome={props.row.outcome}
      facts={
        isGmail() && props.link ? (
          <InboxSyncStatus link={props.link} />
        ) : undefined
      }
      muted={props.row.status === 'off'}
    >
      <GoogleCapabilityActions
        row={props.row}
        link={props.link}
        pending={props.pending}
        removing={props.removing}
        onConnect={props.onConnect}
        onReconnect={props.onReconnect}
        onRemoveGmail={props.onRemoveGmail}
        onTurnOffCalendar={props.onTurnOffCalendar}
      />
    </CapabilityRow>
  );

  return (
    <Show when={isGmail()} fallback={capabilityRow()}>
      <div>
        {capabilityRow()}
        <Show
          when={isOwn() && signaturesFlag().enabled ? props.link : undefined}
        >
          {(link) => (
            <>
              <SettingsRow
                label="Signature"
                description="Added to messages you send from this inbox."
                align="start"
                class="min-h-0 py-3 pl-10"
              >
                <Button
                  variant="outline"
                  size="sm"
                  depth={3}
                  onClick={() => toggleSignatureExpanded(link().id)}
                  aria-label={`Edit signature for ${link().email_address}`}
                  aria-expanded={showSignature()}
                  aria-controls={signatureSectionId()}
                >
                  {showSignature() ? 'Done' : 'Edit'}
                </Button>
              </SettingsRow>
              <Show when={showSignature()}>
                <div id={signatureSectionId()} class="pr-6 pb-5 pl-10">
                  <SignatureSection link={link()} />
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}

function GoogleCapabilityActions(props: {
  row: Capability;
  link: EmailLink | undefined;
  pending: boolean;
  removing: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onRemoveGmail: () => void;
  onTurnOffCalendar: () => void;
}) {
  const isOwn = () => props.row.scope === 'personal';
  const isCalendar = () => props.row.id.startsWith('calendar:');
  const canRevoke = () => !isCalendar() || isOwn();
  const canTurnOffCalendarWithData = () =>
    isCalendar() &&
    isOwn() &&
    Boolean(
      props.link?.has_calendar_data && props.link.needs_calendar_permission
    );
  const disconnectItem = {
    label: 'Disconnect',
    danger: true,
    onSelect: isCalendar() ? props.onTurnOffCalendar : props.onRemoveGmail,
    disabled: !isCalendar() && props.removing,
  };
  const reconnectItem = {
    label: 'Reconnect',
    onSelect: props.onReconnect,
    disabled: props.pending,
  };

  switch (props.row.status) {
    case 'action-required':
      return (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Reconnect"
              onClick={props.onReconnect}
              disabled={props.pending}
            />
          }
          items={canRevoke() ? [reconnectItem, disconnectItem] : []}
        />
      );
    case 'connected':
      return (
        <ConnectionRowActions
          items={canRevoke() ? [reconnectItem, disconnectItem] : []}
        />
      );
    case 'off':
      return (
        <ConnectionRowActions
          primary={
            isOwn() && isCalendar() ? (
              <ConnectAction
                label="Enable"
                onClick={props.onConnect}
                disabled={props.pending}
              />
            ) : undefined
          }
          items={canRevoke() ? [reconnectItem, disconnectItem] : []}
        />
      );
    case 'not-connected':
      return (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label={isCalendar() ? 'Enable calendar' : 'Connect'}
              onClick={props.onConnect}
              disabled={props.pending}
            />
          }
          items={canTurnOffCalendarWithData() ? [disconnectItem] : []}
        />
      );
    default: {
      const _exhaustive: never = props.row.status;
      return _exhaustive;
    }
  }
}
