import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import {
  enableEmailReadReceipts,
  enableEmailSignatures,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { useUserId } from '@core/context/user';
import { useEmailLinks } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { useUpdateEmailSettingsMutation } from '@queries/email/settings';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button, ToggleSwitch } from '@ui';
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
  const readReceipts = useFeatureFlag(enableEmailReadReceipts);
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
      <Show when={readReceipts().enabled}>
        <SettingsSection
          title="Read receipts"
          description="See when recipients open messages you send. Macro adds an invisible image to each message, so opens are approximate: some mail apps load images automatically and others block them. Only people with access to the inbox see its opens."
        >
          <Suspense
            fallback={
              <p role="status" class="text-sm text-ink-muted">
                Loading accounts…
              </p>
            }
          >
            <EmailReadReceipts />
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

function EmailReadReceipts() {
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
          <SettingsRow label="Couldn't load accounts">
            <Button
              variant="outline"
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
            Loading accounts…
          </p>
        }
      >
        <SettingsCard>
          <For
            each={links()}
            fallback={
              <SettingsRow label="Connect an email account above to use read receipts." />
            }
          >
            {(link) => <ReadReceiptsRow link={link} />}
          </For>
        </SettingsCard>
      </Show>
    </Show>
  );
}

function ReadReceiptsRow(props: { link: EmailLink }) {
  const updateSettings = useUpdateEmailSettingsMutation();
  return (
    <SettingsRow label={props.link.email_address}>
      <ToggleSwitch
        size="md"
        label={`Read receipts for ${props.link.email_address}`}
        labelClass="sr-only"
        checked={props.link.settings.read_receipts_enabled ?? false}
        disabled={updateSettings.isPending}
        onChange={(checked) =>
          updateSettings.mutate(
            {
              linkId: props.link.id,
              settings: { read_receipts_enabled: checked },
            },
            { onError: () => toast.failure('Failed to update read receipts.') }
          )
        }
      />
    </SettingsRow>
  );
}
