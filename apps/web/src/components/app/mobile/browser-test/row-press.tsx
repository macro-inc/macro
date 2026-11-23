// The real touch list rows of Chat, Home, Soup lists, Notifications, Agents,
// Projects and Search over synthetic entities, with the app's row press installed;
// no network.
import '@fontsource-variable/inter';
import '../../../../index.css';
// The inbox card layouts sit on an import cycle that the app enters through
// @entity; enter it the same way.
import '@entity';
import { AgentSessionRow } from '@app/features/agents-view/components/AgentSessionRow';
import { PhoneConversationRow } from '@app/features/agents-view/views/shared/phone-conversation-row/phone-conversation-row';
import { ChannelFeedRow } from '@app/features/channels-view/components/ChannelFeedRow';
import {
  ChannelPin,
  ChannelPinGrid,
} from '@app/features/channels-view/components/ChannelPins';
import { InboxListEntity } from '@app/features/next-soup/soup-view/views/inbox/InboxListEntity';
import { NotificationRow } from '@app/features/notifications-inbox/components/notification-row';
import { ProjectRowMenu } from '@app/features/projects/components/project-row-menu';
import { ProjectRow } from '@app/features/projects/project-row';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, EntityProvider, ListEntity } from '@entity';
import { authKeys } from '@queries/auth/keys';
import { staticChannelDirectory } from '@queries/channel/directory';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { CommandMenuListItem } from '@ui/components/CommandMenuPrimitives';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';
import { installRowPress } from '../rowPress';
import { SwipableRow, SwipableRowProvider } from '../SwipableRow';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';
document.documentElement.dataset.touchDevice = String(isTouchDevice());

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|viewer@example.test',
  email: 'viewer@example.test',
  authenticated: true,
});

const channel = (id: string, name: string): ChannelEntity => {
  // No picture, so the avatar shows the channel's kind.
  queryClient.setQueryData(channelKeys.picture(id).queryKey, null);
  return {
    id,
    type: 'channel',
    name,
    ownerId: 'macro|viewer@example.test',
    channelType: 'public',
    isParticipant: true,
  };
};

const project = {
  project: {
    id: 'project',
    name: 'Launch',
    updatedAt: '2026-11-01T09:00:00Z',
    access: 'view' as const,
  },
  properties: [],
};

function Fixture() {
  const [opened, setOpened] = createSignal('');
  const [list, setList] = createSignal<HTMLElement>();
  onCleanup(installRowPress());
  const open = (row: string) => () => setOpened(row);

  return (
    <main
      ref={setList}
      data-opened={opened()}
      class="soup-list h-dvh overflow-y-auto bg-panel text-ink"
    >
      <SwipableRowProvider container={list} onSwipeLeft={() => {}}>
        <section data-testid="chat-pins">
          <ChannelPinGrid horizontal>
            <div class="block w-28 shrink-0" data-testid="pin">
              <ChannelPin
                channel={channel('pin', 'design')}
                unread={false}
                onActivate={open('pin')}
              />
            </div>
          </ChannelPinGrid>
        </section>
        <section data-testid="chat">
          <ChannelFeedRow
            channel={channel('chat', 'launch')}
            unread
            mentions={0}
            ringing={false}
            divider
            onOpen={open('chat')}
          />
        </section>
        {/* Mounted as HomeList mounts its touch rows. */}
        <section data-testid="home" data-soup-entity role="row">
          <InboxListEntity
            entity={channel('home', 'general')}
            onClick={open('home')}
          />
        </section>
        {/* Mounted as a Soup list (Drive, Tasks, soup views) mounts its
            rows on a phone, inside the context menu's row container. */}
        <section data-testid="list" data-soup-entity>
          <ListEntity
            entity={channel('list', 'roadmap')}
            onClick={open('list')}
          />
        </section>
        <section data-testid="notification">
          <SwipableRow id="notification" swipeLeftColor="bg-success">
            <NotificationRow
              id="notification"
              icon={<span class="size-11 rounded-full bg-surface-2" />}
              who="Ana"
              what="Message"
              body="Lunch next week?"
              time="9:00 AM"
              count={1}
              unfolded={false}
              unseen
              highlighted={false}
              onClick={open('notification')}
              onHover={() => {}}
              onDone={() => {}}
              onToggleStack={() => {}}
            />
          </SwipableRow>
        </section>
        <section data-testid="agent" class="px-2">
          <AgentSessionRow
            id="agent"
            title="Plan the launch"
            kind="chat"
            state="dormant"
            leading={<span class="size-4" />}
            timestamp="9:00 AM"
            onOpen={open('agent')}
          />
        </section>
        {/* Mounted as the phone Agents list mounts its rows, inside the
            context menu's row container. */}
        <section data-testid="agent-phone" data-soup-entity>
          <PhoneConversationRow
            conversation={{
              id: 'agent-phone',
              type: 'chat',
              name: 'Draft the notes',
              ownerId: 'macro|viewer@example.test',
            }}
            mode="chat"
            actions={{
              openPullRequest: () => {},
              openBranch: () => {},
              copyBranch: async () => true,
              unarchive: async () => true,
            }}
            onOpen={open('agent-phone')}
          />
        </section>
        <section data-testid="project">
          <ProjectRow
            rowId="project"
            row={project}
            highlighted={false}
            checked={false}
            onFocus={() => {}}
            onOpen={open('project')}
            onChecked={() => {}}
            onSave={async () => {}}
          />
        </section>
        {/* Long-pressed open its action drawer, as the phone Projects list
            mounts its rows. */}
        <section data-testid="project-menu">
          <ProjectRowMenu
            targets={() => [project]}
            canOpenInNewSplit={false}
            onOpenInNewSplit={() => {}}
            onRename={() => {}}
            onSetOption={() => {}}
            onCopyLink={() => {}}
            onCopyId={() => {}}
            onDelete={() => {}}
            onOpenChange={(menuOpen) => {
              if (menuOpen) setOpened('project-menu');
            }}
          >
            <ProjectRow
              rowId="project-in-menu"
              row={project}
              highlighted={false}
              checked={false}
              onFocus={() => {}}
              onOpen={open('project-in-menu')}
              onChecked={() => {}}
              onSave={async () => {}}
            />
          </ProjectRowMenu>
        </section>
        <section data-testid="search" class="px-2">
          <CommandMenuListItem class="min-h-11" onClick={open('search')}>
            Recent search
          </CommandMenuListItem>
        </section>
      </SwipableRowProvider>
      {/* Room to scroll, for presses that turn into one. */}
      <div class="h-[150vh]" />
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
              <ChannelDirectoryProvider
                directory={staticChannelDirectory(() => [])}
              >
                <EmailLinksContextProvider>
                  <StaticMarkdownContext>
                    <MemoryRouter>
                      <Route path="*" component={Fixture} />
                    </MemoryRouter>
                  </StaticMarkdownContext>
                </EmailLinksContextProvider>
              </ChannelDirectoryProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
