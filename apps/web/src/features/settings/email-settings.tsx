import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableEmailSignatures } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { useUserId } from '@core/context/user';
import { useEmailLinks } from '@core/email-link';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useHiddenContactsQuery,
  useSetContactHiddenMutation,
} from '@queries/contacts/hidden';
import { Button } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import { EmailCard } from './Email';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import { SignatureSection } from './SignatureSection';

export function EmailSettings() {
  const signatures = useFeatureFlag(enableEmailSignatures);
  const { openSettings } = useSettingsState();
  const isAvailable = useSettingsTabAvailable();
  return (
    <SettingsPage
      title="Email"
      description="Manage your inboxes and the signature you send with each account."
    >
      <SettingsSection
        title="Accounts"
        description="Connect email accounts and manage their sync with Macro."
      >
        <Suspense
          fallback={
            <p role="status" class="text-sm text-ink-muted">
              Loading accounts…
            </p>
          }
        >
          <EmailCard />
        </Suspense>
      </SettingsSection>
      <SettingsSection
        title="Hidden contacts"
        description="Hidden people stay out of direct messages, mentions, and email suggestions."
      >
        <Suspense
          fallback={
            <p role="status" class="text-sm text-ink-muted">
              Loading hidden contacts…
            </p>
          }
        >
          <HiddenContacts />
        </Suspense>
      </SettingsSection>
      <Show when={signatures().enabled}>
        <SettingsSection
          title="Signatures"
          description="Create a signature for each email account and preview it before sending."
        >
          <Suspense
            fallback={
              <p role="status" class="text-sm text-ink-muted">
                Loading signatures…
              </p>
            }
          >
            <EmailSignatures />
          </Suspense>
        </SettingsSection>
      </Show>
      <Show when={isAvailable('Notifications') || isAvailable('Calendar')}>
        <SettingsSection title="Related settings">
          <SettingsCard>
            <Show when={isAvailable('Notifications')}>
              <SettingsRow
                stackOnNarrow
                label="Email notifications"
                description="Choose your email alerts and digest delivery."
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettings('Notifications')}
                >
                  Manage notifications
                </Button>
              </SettingsRow>
            </Show>
            <Show when={isAvailable('Calendar')}>
              <SettingsRow
                stackOnNarrow
                label="Calendars"
                description="Manage the calendars connected to your email accounts."
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettings('Calendar')}
                >
                  Manage calendars
                </Button>
              </SettingsRow>
            </Show>
          </SettingsCard>
        </SettingsSection>
      </Show>
    </SettingsPage>
  );
}

function HiddenContacts() {
  const query = useHiddenContactsQuery();
  const unhide = useSetContactHiddenMutation();
  const contacts = () => query.data?.contacts ?? [];

  return (
    <Show
      when={!query.isError}
      fallback={
        <SettingsCard>
          <SettingsRow label="Couldn't load hidden contacts">
            <Button
              variant="secondary"
              onClick={() => fireAndForget(query.refetch(), 'hidden-contacts')}
            >
              Try again
            </Button>
          </SettingsRow>
        </SettingsCard>
      }
    >
      <Show
        when={!query.isPending}
        fallback={
          <p role="status" class="text-sm text-ink-muted">
            Loading hidden contacts…
          </p>
        }
      >
        <SettingsCard>
          <Show
            when={contacts().length > 0}
            fallback={<SettingsRow label="No hidden contacts." />}
          >
            <For each={contacts()}>
              {(userId) => {
                const email = idToEmail(userId);
                const name = idToDisplayName(userId);
                return (
                  <SettingsRow
                    label={name || email}
                    description={name && name !== email ? email : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={unhide.isPending}
                      onClick={() => {
                        fireAndForget(
                          unhide.mutateAsync({ userId, hidden: false }).then(
                            () =>
                              toast.success(
                                t('entityActions.toastContactUnhidden')
                              ),
                            () =>
                              toast.failure(
                                t('entityActions.toastContactUnhiddenFailed')
                              )
                          ),
                          'unhide-contact'
                        );
                      }}
                    >
                      Unhide
                    </Button>
                  </SettingsRow>
                );
              }}
            </For>
          </Show>
        </SettingsCard>
      </Show>
    </Show>
  );
}

function EmailSignatures() {
  const userId = useUserId();
  const { query } = useEmailLinks();
  const links = () =>
    query.isSuccess
      ? query.data.links.filter((link) => link.macro_id === userId())
      : [];
  return (
    <Show
      when={!query.isError}
      fallback={
        <SettingsCard>
          <SettingsRow label="Couldn't load signatures">
            <Button
              variant="secondary"
              onClick={() => fireAndForget(query.refetch(), 'email-settings')}
            >
              Try again
            </Button>
          </SettingsRow>
        </SettingsCard>
      }
    >
      <Show
        when={!query.isPending}
        fallback={
          <p role="status" class="text-sm text-ink-muted">
            Loading signatures…
          </p>
        }
      >
        <For
          each={links()}
          fallback={
            <SettingsCard>
              <SettingsRow label="Connect an email account above to add a signature." />
            </SettingsCard>
          }
        >
          {(link) => (
            <Suspense
              fallback={
                <p role="status" class="text-sm text-ink-muted">
                  Loading signature…
                </p>
              }
            >
              <SignatureSection link={link} />
            </Suspense>
          )}
        </For>
      </Show>
    </Show>
  );
}
