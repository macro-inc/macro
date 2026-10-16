import Caret from '@phosphor/caret-right.svg';
import Hash from '@phosphor/hash.svg';
import Search from '@phosphor/magnifying-glass.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import { Tabs } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewSidebar } from '../DemoViewSidebar';
import { SearchBar } from '../email/frozen/SearchBar';

function ChatGroup(props: { title: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(true);
  return (
    <section class="chat-sidebar-group" data-open={open()}>
      <button
        class="chat-sidebar-group-heading"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span>{props.title}</span>
        <Caret class="size-3" classList={{ 'rotate-90': open() }} />
      </button>
      <Show when={open()}>
        <ViewSidebar.Nav>{props.children}</ViewSidebar.Nav>
      </Show>
    </section>
  );
}

/** Local data adapter for the app's ExpandedChannelsRail layout. */
export function ChatSidebar(props: {
  workspace: DummyWorkspace;
  collapse: () => void;
  navigate: (id: string) => void;
}) {
  const w = props.workspace;
  const [tab, setTab] = createSignal('all');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const label = (channel: (typeof w.data.channels)[number]) =>
    channel.person ? homepagePeople[channel.person].name : channel.id;
  const channels = () =>
    w.data.channels.filter((c) =>
      label(c).toLowerCase().includes(query().trim().toLowerCase())
    );
  const open = (id: string, thread?: string) => {
    props.navigate(id);
    w.setChannelThread(thread);
  };
  const rows = (items: ReturnType<typeof channels>) => (
    <For each={items}>
      {(c) => (
        <ViewSidebar.Item
          active={w.channel() === c.id}
          onClick={() => open(c.id)}
        >
          <ViewSidebar.Icon>
            <Show when={c.person} fallback={<Hash />}>
              {(person) => (
                <img
                  class="size-5 rounded-full"
                  src={homepagePeople[person()].photo}
                  alt=""
                />
              )}
            </Show>
          </ViewSidebar.Icon>
          <span class="truncate">{label(c)}</span>
        </ViewSidebar.Item>
      )}
    </For>
  );
  return (
    <ViewSidebar.Root aria-label="Chat navigation" class="chat-sidebar">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.Control
            label="Collapse sidebar"
            onClick={props.collapse}
          >
            <Sidebar />
          </ViewSidebar.Control>
          <ViewSidebar.Title>Chat</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <ViewSidebar.Toolbar>
          <Tabs
            aria-label="Chat sidebar views"
            list={[
              { value: 'all', label: 'All' },
              { value: 'recent', label: 'Recent' },
              { value: 'threads', label: 'Threads' },
            ]}
            value={tab()}
            onChange={setTab}
          />
          <ViewSidebar.Control
            label={searchOpen() ? 'Close search' : 'Search conversations'}
            aria-pressed={searchOpen()}
            onClick={() => {
              setSearchOpen(!searchOpen());
              setQuery('');
            }}
          >
            <Search class="size-3.5" />
          </ViewSidebar.Control>
        </ViewSidebar.Toolbar>
      </ViewSidebar.Primary>
      <Show when={searchOpen()}>
        <div class="px-4 pt-2">
          <SearchBar
            label="Search channels and direct messages"
            placeholder="Search conversations"
            value={query()}
            onValueChange={setQuery}
          />
        </div>
      </Show>
      <ViewSidebar.Content>
        <Show when={tab() === 'all'}>
          <ChatGroup title="Favorites">
            {rows(
              channels()
                .filter((c) => !c.person)
                .slice(0, 2)
            )}
          </ChatGroup>
          <div class="chat-sidebar-conversations">
            <ChatGroup title="Channels">
              {rows(channels().filter((c) => !c.person))}
            </ChatGroup>
            <ChatGroup title="DMs">
              {rows(channels().filter((c) => c.person))}
            </ChatGroup>
          </div>
        </Show>
        <Show when={tab() === 'recent'}>
          <ViewSidebar.Nav>
            {rows(
              channels()
                .filter((c) => c.messages.length)
                .slice()
                .reverse()
            )}
          </ViewSidebar.Nav>
        </Show>
        <Show when={tab() === 'threads'}>
          <ViewSidebar.Nav>
            <For each={channels()}>
              {(c) => (
                <For
                  each={c.messages.filter(
                    (m) =>
                      !m.replyTo &&
                      c.messages.some((reply) => reply.replyTo === m.id)
                  )}
                >
                  {(m) => (
                    <button
                      class="chat-sidebar-thread"
                      onClick={() => open(c.id, m.id)}
                    >
                      <span class="text-xs text-ink-muted">{label(c)}</span>
                      <span class="line-clamp-2 text-sm text-ink">
                        {m.body.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}
                      </span>
                    </button>
                  )}
                </For>
              )}
            </For>
          </ViewSidebar.Nav>
        </Show>
        <Show when={!channels().length}>
          <p class="px-2 text-sm text-ink-muted">No conversations found</p>
        </Show>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
