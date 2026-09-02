import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from '@app/features/calendar/components/TurnOffCalendarDialog';
import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow } from '@core/email-link';
import { useRemoveInboxMutation } from '@queries/email/link';
import type { ConsentScopes } from '@service-auth/client';
import { createSignal, For, Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import {
  type Capability,
  type ConnectionsModel,
  capabilitiesFor,
} from './model';
import { connectionState, statusLabel } from './status';
import { showConnectionsOverview } from './view-state';

export function GoogleProvider(props: { model: ConnectionsModel }) {
  const rows = () => capabilitiesFor(props.model, 'google');
  const ready = () => rows().filter((row) => row.status === 'connected').length;
  const inboxes = () => {
    const emails = [...new Set(rows().map((row) => row.account))];
    return emails.map((email) => ({
      email,
      scope: rows().find((row) => row.account === email)?.scope ?? 'personal',
      caps: rows().filter((row) => row.account === email),
    }));
  };

  const startAddInbox = useAddInboxFlow();
  const removeInbox = useRemoveInboxMutation({
    onSuccess: () => toast.success('Inbox removed'),
    onError: () => toast.failure('Failed to remove inbox. Please try again.'),
  });
  const [pending, setPending] = createSignal(false);
  const [calendarTarget, setCalendarTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);

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
      description={
        rows().length > 0
          ? `${ready()} of ${rows().length} capabilities ready`
          : 'Connect a Google account to bring mail and calendar into Macro.'
      }
      onBack={showConnectionsOverview}
    >
      <Show
        when={inboxes().length > 0}
        fallback={
          <SettingsSection title="Your connections">
            <SettingsCard>
              <SettingsRow
                label="Use Gmail in Macro"
                description="Read and send mail from a Google account in Macro."
              >
                <ConnectAction
                  label="Connect"
                  onClick={() => void connect()}
                  disabled={pending()}
                />
              </SettingsRow>
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
                    <SettingsRow
                      align="start"
                      label={
                        <span class="flex items-center gap-2">
                          {row.title}
                          <StatusDot
                            state={connectionState(row.status)}
                            label={statusLabel(row.status)}
                          />
                        </span>
                      }
                      description={`${row.outcome} ${row.account} · ${
                        row.scope === 'shared' ? 'Shared' : 'Personal'
                      } · ${statusLabel(row.status)}`}
                    >
                      <Show
                        when={row.status === 'action-required'}
                        fallback={
                          <Show
                            when={row.status === 'connected'}
                            fallback={
                              <ConnectAction
                                label="Connect"
                                onClick={() =>
                                  void connect(
                                    row.id.startsWith('calendar:')
                                      ? 'calendar'
                                      : 'gmail'
                                  )
                                }
                                disabled={pending()}
                              />
                            }
                          >
                            <ConnectAction
                              label="Disconnect from Macro"
                              variant="danger"
                              onClick={() => {
                                const linkId = linkIdFor(row);
                                if (!linkId) return;
                                if (row.id.startsWith('calendar:')) {
                                  setCalendarTarget({
                                    linkId,
                                    emailAddress: row.account,
                                  });
                                  return;
                                }
                                removeInbox.mutate(linkId);
                              }}
                              disabled={removeInbox.isPending}
                            />
                          </Show>
                        }
                      >
                        <ConnectAction
                          label="Reconnect"
                          onClick={() => void connect()}
                          disabled={pending()}
                        />
                      </Show>
                    </SettingsRow>
                  )}
                </For>
              </SettingsCard>
            </SettingsSection>
          )}
        </For>
      </Show>

      <Show when={rows().length > 0}>
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
    </SettingsPage>
  );
}
