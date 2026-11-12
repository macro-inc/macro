// The real inbox row, avatar and card text over synthetic channel
// notifications; no network.
import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import { authKeys } from '@queries/auth/keys';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { NotificationRow } from '../components/notification-row';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { describeInboxCard } from '../primitives/describe-row';
import { InboxRowAvatar } from '../views/inbox-row-avatar';

const VIEWER_ID = 'macro|viewer@example.test';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'viewer@example.test',
  authenticated: true,
});

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const dark =
  new URLSearchParams(window.location.search).get('theme') !== 'light';
document.documentElement.dataset.themeLight = String(!dark);
const theme = dark ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const PEOPLE = [
  'Ana',
  'Leo',
  'Mara',
  'Noor',
  'Sam',
  'Theo',
  'Uma',
  'Vic',
  'Wes',
];
const idOf = (name: string) => `macro|${name.toLowerCase()}@example.test`;
const nameOf = (id: string) =>
  PEOPLE.find((name) => idOf(name) === id) ?? 'Someone';

const message = (
  id: string,
  sender: string,
  content: Record<string, unknown>
) =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel',
    sender_id: idOf(sender),
    created_at: '2026-11-12T09:00:00Z',
    notification_metadata: {
      tag: 'channel_message_send',
      content: { senderDisplayName: sender, ...content },
    },
  }) as unknown as UnifiedNotification;

const channelRow = (
  id: string,
  name: string,
  channelType: string,
  senders: string[],
  notificationName = name
): NotificationInboxRow => {
  // The channel has no picture, so a group chat shows its kind.
  queryClient.setQueryData(channelKeys.picture(id).queryKey, null);
  return {
    id,
    type: 'channel_messages',
    revision: 'rev',
    latestAt: Date.parse('2026-11-12T09:00:00Z'),
    actor: { kind: 'user', id: idOf(senders[0] ?? '') },
    actions: [],
    unseen: true,
    count: senders.length,
    content: {
      entity: { type: 'channel', id, name, channelType } as never,
      notifications: senders.map((sender, index) =>
        message(`${id}-${index}`, sender, {
          channelType,
          channelName: notificationName,
          messageContent: `Message ${senders.length - index}`,
        })
      ),
    },
  };
};

const ROWS = [
  channelRow('named-group', 'remote', 'private', PEOPLE),
  channelRow(
    'unnamed-group',
    'Ana, Leo, Mara, Noor, Sam, Theo',
    'private',
    ['Sam', 'Ana'],
    'Viewer, Ana, Leo, Mara, Noor, Theo'
  ),
  channelRow('public', 'launch', 'public', ['Ana', 'Leo']),
  channelRow('dm', 'Ana', 'directMessage', ['Ana']),
];

const names = { userName: nameOf, senderName: () => undefined };

function Fixture() {
  return (
    <main class="flex w-full max-w-[640px] flex-col bg-panel text-ink">
      <For each={ROWS}>
        {(row) => {
          const display = () => describeInboxCard(row, names);
          return (
            <div data-testid={row.id}>
              <NotificationRow
                id={row.id}
                icon={<InboxRowAvatar row={row} />}
                who={display().who}
                what={display().what}
                body={display().body}
                time="9:00 AM"
                count={row.count}
                unfolded={false}
                unseen={row.unseen}
                highlighted={false}
                onClick={() => {}}
                onHover={() => {}}
                onDone={() => {}}
                onToggleStack={() => {}}
              />
            </div>
          );
        }}
      </For>
    </main>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelsContextProvider>
                <EmailLinksContextProvider>
                  <MobileSettingsProvider>
                    <StaticMarkdownContext>
                      <MemoryRouter>
                        <Route path="*" component={Fixture} />
                      </MemoryRouter>
                    </StaticMarkdownContext>
                  </MobileSettingsProvider>
                </EmailLinksContextProvider>
              </ChannelsContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
