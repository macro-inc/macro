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
import { useAddInboxFlow } from '@core/email-link';
import SignatureIcon from '@phosphor-icons/core/regular/signature.svg?component-solid';
import {
  useEmailLinksQuery,
  useRemoveInboxMutation,
} from '@queries/email/link';
import type { ConsentScopes } from '@service-auth/client';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { InboxSyncStatus } from '../inbox-sync-status';
import { ConnectAction } from '../integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import {
  clearSignatureState,
  isSignatureExpanded,
  SignatureSection,
  toggleSignatureExpanded,
} from '../SignatureSection';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type Capability,
  type ConnectionsModel,
  capabilitiesFor,
} from './model';
import { closeConnectionsProvider } from './view-state';

export function GoogleProvider(props: { model: ConnectionsModel }) {
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
    id
      ? emailLinks.data?.links.find((link) => link.id === id)
      : undefined;
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

  return (
    <SettingsPage
      title="Google"
      description="Read, organize, and act on your email."
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
              title={inbox.email}
              description={inbox.scope === 'shared' ? 'Shared' : 'Personal'}
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
                          row.id.startsWith('calendar:')
                            ? 'calendar'
                            : 'gmail'
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

  return (
    <>
      <CapabilityRow
        title={props.row.title}
        outcome={props.row.outcome}
        facts={
          isGmail() && props.link ? (
            <InboxSyncStatus link={props.link} />
          ) : (
            capabilityFacts(props.row)
          )
        }
        status={props.row.status}
      >
        <Show
          when={
            isGmail() && isOwn() && signaturesFlag().enabled
              ? props.link
              : undefined
          }
        >
          {(link) => (
            <Tooltip label="Edit signature">
              <Button
                variant="outline"
                size="icon-sm"
                depth={3}
                onClick={() => toggleSignatureExpanded(link().id)}
                aria-label={`Edit signature for ${link().email_address}`}
                aria-expanded={showSignature()}
                aria-controls={signatureSectionId()}
              >
                <SignatureIcon class="size-4" />
              </Button>
            </Tooltip>
          )}
        </Show>
        <GoogleCapabilityActions
          row={props.row}
          pending={props.pending}
          removing={props.removing}
          onConnect={props.onConnect}
          onReconnect={props.onReconnect}
          onRemoveGmail={props.onRemoveGmail}
          onTurnOffCalendar={props.onTurnOffCalendar}
        />
      </CapabilityRow>
      <Show when={showSignature() ? props.link : undefined}>
        {(link) => (
          <div id={signatureSectionId()} class="px-6 pb-5">
            <SignatureSection link={link()} />
          </div>
        )}
      </Show>
    </>
  );
}

function GoogleCapabilityActions(props: {
  row: Capability;
  pending: boolean;
  removing: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onRemoveGmail: () => void;
  onTurnOffCalendar: () => void;
}) {
  const isOwn = () => props.row.scope === 'personal';
  const isCalendar = () => props.row.id.startsWith('calendar:');

  return (
    <Show
      when={props.row.status === 'action-required'}
      fallback={
        <Show
          when={
            props.row.status === 'connected' || props.row.status === 'off'
          }
          fallback={
            <ConnectAction
              label={isCalendar() ? 'Enable calendar' : 'Connect'}
              onClick={props.onConnect}
              disabled={props.pending}
            />
          }
        >
          <Show
            when={isCalendar()}
            fallback={
              <ConnectAction
                label="Disconnect from Macro"
                variant="danger"
                onClick={props.onRemoveGmail}
                disabled={props.removing}
              />
            }
          >
            <Show when={isOwn() && props.row.status === 'connected'}>
              <ConnectAction
                label="Disconnect from Macro"
                variant="danger"
                onClick={props.onTurnOffCalendar}
              />
            </Show>
            <Show when={isOwn() && props.row.status === 'off'}>
              <ConnectAction
                label="Turn on"
                onClick={props.onConnect}
                disabled={props.pending}
              />
            </Show>
          </Show>
        </Show>
      }
    >
      <ConnectAction
        label="Reconnect"
        onClick={props.onReconnect}
        disabled={props.pending}
      />
    </Show>
  );
}
