import Reply from '@phosphor/arrow-bend-up-left.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Envelope from '@phosphor/envelope.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Plus from '@phosphor/plus.svg';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ViewSidebar } from '../DemoViewSidebar';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import '../workspace/dummy-workspace.css';
import './channel-stories.css';

/** Measures `selector` inside `frame` and returns the cursor's tip position. */
function createCursorTarget(
  frame: () => HTMLElement | undefined,
  selector: () => string | undefined
) {
  const [point, setPoint] = createSignal<{ x: number; y: number }>();
  onMount(() => {
    const measure = () => {
      const root = frame();
      const query = selector();
      const target = query
        ? root?.querySelector<HTMLElement>(query)
        : undefined;
      if (!root || !target) return setPoint(undefined);
      const bounds = target.getBoundingClientRect();
      const parent = root.getBoundingClientRect();
      setPoint({
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 48),
        y: bounds.top - parent.top + bounds.height / 2,
      });
    };
    createEffect(() => {
      selector();
      const id = requestAnimationFrame(measure);
      onCleanup(() => cancelAnimationFrame(id));
    });
    const observer = new ResizeObserver(measure);
    const root = frame();
    if (root) observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  return point;
}

/** @mention a doc in a channel; a new member opens it with no access request. */
export function ChannelSharedWorkDemo() {
  let root!: HTMLDivElement;
  let frame: HTMLDivElement | undefined;
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'staging',
      person: 'gabriel',
      body: 'Staging is green. Invite flow and email replies both pass.',
      time: '9:02 AM',
    },
    {
      id: 'plan-request',
      person: 'julia',
      body: 'Here’s the plan for Thursday. Everyone check your part before we share it with the team.',
      time: '9:15 AM',
      documentId: 'plan',
    },
    {
      id: 'welcome',
      person: 'jacob',
      body: 'Welcome to #launch @[Teo](demo-mention:teo). Everything we’ve linked here is yours to open.',
      time: '9:21 AM',
    },
  ]);
  w.open('messages', 'launch');
  const [step, setStep] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const open = () => {
    setStep(2);
    setAutomatic(false);
    w.open('documents', 'plan');
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 2,
    reset: () => {},
    reduced: open,
    delay: (next) => (next === 1 ? 1200 : 1500),
    advance: (next) => {
      if (next === 2) open();
      else setStep(next);
    },
  });
  const pointer = createCursorTarget(
    () => frame,
    () =>
      automatic() && step() === 1
        ? '[data-thread-id="plan-request"] .dummy-entity-link'
        : undefined
  );
  return (
    <div ref={frame} class="channel-demo-frame">
      <ProductDemo
        ref={(el) => (root = el)}
        label="Open a document someone mentioned in the channel"
        onInteract={() => {
          setAutomatic(false);
          playback.pause();
        }}
        height={500}
        mobileHeight={600}
      >
        <ProductWorkspace workspace={w} />
      </ProductDemo>
      <Show when={pointer()}>
        {(p) => (
          <DemoCursor
            label="Teo"
            class="channel-demo-cursor"
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

type InboxRow = {
  id: string;
  group: 'Today' | 'Yesterday';
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  person?: keyof typeof homepagePeople;
  title: JSX.Element;
  time: string;
  unread?: boolean;
  view: WorkspaceView;
  item: string;
  thread?: string;
};

const inboxRows: InboxRow[] = [
  {
    id: 'launch-thread',
    group: 'Today',
    icon: Reply,
    title: (
      <>
        <span class="shrink-0">Julia</span>
        <span class="shrink-0 whitespace-pre"> in </span>
        <span class="truncate">#launch</span>
      </>
    ),
    time: '9:41 AM',
    unread: true,
    view: 'messages',
    item: 'launch',
    thread: 'm1',
  },
  {
    id: 'dm-teo',
    group: 'Today',
    person: 'teo',
    title: 'Teo',
    time: '9:32 AM',
    unread: true,
    view: 'messages',
    item: 'dm-teo',
  },
  {
    id: 'dana',
    group: 'Today',
    icon: Envelope,
    title: 'Next steps for our team',
    time: '9:20 AM',
    unread: true,
    view: 'email',
    item: 'dana',
  },
  {
    id: 'invite-task',
    group: 'Today',
    icon: ListChecks,
    title: 'Fix the team invite handoff',
    time: '9:05 AM',
    view: 'tasks',
    item: 'invite',
  },
  {
    id: 'engineers',
    group: 'Yesterday',
    icon: Hash,
    title: 'engineers',
    time: 'Sep 28',
    view: 'messages',
    item: 'engineers',
  },
  {
    id: 'plan-comment',
    group: 'Yesterday',
    icon: ChatTeardrop,
    title: (
      <>
        <span class="shrink-0">Gabriel</span>
        <span class="shrink-0 whitespace-pre"> commented on </span>
        <span class="truncate">Q3 launch plan</span>
      </>
    ),
    time: 'Sep 28',
    view: 'documents',
    item: 'plan',
  },
  {
    id: 'design',
    group: 'Yesterday',
    icon: Hash,
    title: 'design',
    time: 'Sep 28',
    view: 'messages',
    item: 'design',
  },
];

/** features/home on desktop: Home header, New chat, date groups, E = Mark done. */
export function ChatInboxDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  const [rows, setRows] = createSignal(inboxRows);
  const [selected, setSelected] = createSignal<string>();
  const [key, setKey] = createSignal<string>();
  const select = (id: string | undefined) => {
    setSelected(id);
    const row = rows().find((r) => r.id === id);
    if (!row) return;
    w.open(row.view, row.item);
    if (row.view === 'messages') {
      w.setChannel(row.item);
      w.setChannelThread(row.thread);
    }
    setRows((list) =>
      list.map((r) => (r.id === id ? { ...r, unread: false } : r))
    );
  };
  const done = () => {
    const list = rows();
    const index = list.findIndex((r) => r.id === selected());
    if (index < 0) return;
    const next = list[index + 1] ?? list[index - 1];
    setRows(list.filter((r) => r.id !== selected()));
    select(next?.id);
  };
  const press = (next: string) => {
    setKey(next);
    if (next === 'e') done();
    if (next === 'u')
      setRows((list) =>
        list.map((r) => (r.id === selected() ? { ...r, unread: true } : r))
      );
    if (next === 'j' || next === 'k') {
      const list = rows();
      const index = list.findIndex((r) => r.id === selected());
      const target = list[index + (next === 'j' ? 1 : -1)] ?? list[index];
      select(target?.id);
    }
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: () => {
      setRows(inboxRows.slice(2));
      select('dana');
    },
    delay: (step) => [0, 900, 1600, 1500, 1500][step] ?? 1400,
    advance: (step) => {
      if (step === 1) {
        setKey(undefined);
        select('launch-thread');
      }
      if (step === 2 || step === 3) press('e');
      if (step === 4) setKey(undefined);
    },
  });
  const pause = () => playback.pause();
  return (
    <div class="chat-inbox-demo">
      <ProductDemo
        ref={(el) => (root = el)}
        label="Messages wait in Home until you mark them done"
        onInteract={pause}
        height={520}
        mobileHeight={600}
      >
        <div
          class="product-sidebared-scene chat-inbox-scene"
          tabIndex={0}
          role="group"
          aria-label="Home"
          onKeyDown={(event) => {
            const next = event.key.toLowerCase();
            if (['e', 'u', 'j', 'k'].includes(next)) {
              event.preventDefault();
              pause();
              press(next);
            }
          }}
        >
          <ViewSidebar.Root aria-label="Home" class="chat-inbox-list">
            <ViewSidebar.Header>
              <ViewSidebar.Title>Home</ViewSidebar.Title>
            </ViewSidebar.Header>
            <ViewSidebar.Primary>
              <ViewSidebar.Action onClick={() => pause()}>
                <ViewSidebar.Icon>
                  <Plus />
                </ViewSidebar.Icon>
                New chat
              </ViewSidebar.Action>
            </ViewSidebar.Primary>
            <ViewSidebar.Content>
              <For each={['Today', 'Yesterday'] as const}>
                {(group) => (
                  <Show when={rows().some((r) => r.group === group)}>
                    <p class="chat-inbox-group">{group}</p>
                    <ViewSidebar.Nav>
                      <For each={rows().filter((r) => r.group === group)}>
                        {(row) => (
                          <ViewSidebar.Item
                            class="group/home-item chat-inbox-row"
                            active={selected() === row.id}
                            data-home-item={row.id}
                            onClick={() => {
                              pause();
                              select(row.id);
                            }}
                          >
                            <Show
                              when={row.person}
                              fallback={
                                <ViewSidebar.Icon>
                                  <Dynamic component={row.icon} />
                                </ViewSidebar.Icon>
                              }
                            >
                              {(person) => (
                                <img
                                  class="size-5 shrink-0 rounded-full"
                                  src={homepagePeople[person()].photo}
                                  alt=""
                                />
                              )}
                            </Show>
                            <span
                              class="flex min-w-0 flex-1 items-center truncate"
                              classList={{ 'text-ink': row.unread }}
                            >
                              {row.title}
                            </span>
                            <span class="chat-inbox-time">{row.time}</span>
                            <Show when={row.unread}>
                              <span
                                aria-label="Unread"
                                class="size-1.5 shrink-0 rounded-full bg-accent"
                              />
                            </Show>
                          </ViewSidebar.Item>
                        )}
                      </For>
                    </ViewSidebar.Nav>
                  </Show>
                )}
              </For>
            </ViewSidebar.Content>
          </ViewSidebar.Root>
          <div class="dummy-main chat-inbox-preview">
            <Show
              when={selected()}
              fallback={
                <p class="chat-inbox-empty">Select something to read it.</p>
              }
            >
              <ProductWorkspace workspace={w} />
            </Show>
          </div>
        </div>
      </ProductDemo>
      <div class="chat-shortcut-dock" aria-label="Home shortcuts">
        <For
          each={
            [
              { key: 'j', label: 'Next' },
              { key: 'k', label: 'Previous' },
              { key: 'e', label: 'Mark done' },
              { key: 'u', label: 'Mark unread' },
            ] as const
          }
        >
          {(shortcut) => (
            <button
              type="button"
              data-active={key() === shortcut.key}
              onClick={() => {
                pause();
                if (!selected()) select(rows()[0]?.id);
                else press(shortcut.key);
              }}
              aria-label={`${shortcut.label} (${shortcut.key.toUpperCase()})`}
            >
              <kbd>{shortcut.key.toUpperCase()}</kbd>
              {shortcut.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

const threadReplies = [
  {
    id: 'reply-1',
    person: 'teo' as const,
    body: 'Yes. Lead with the invite flow, that’s what changes for existing teams.',
    time: '9:32 AM',
  },
  {
    id: 'reply-2',
    person: 'jacob' as const,
    body: 'Agreed. And link the rollout doc for anyone moving a whole team over.',
    time: '9:34 AM',
  },
  {
    id: 'reply-3',
    person: 'gabriel' as const,
    body: 'I’ll grab screenshots of the new invite screen this afternoon.',
    time: '9:36 AM',
  },
  {
    id: 'reply-4',
    person: 'teo' as const,
    body: 'Screenshot of the existing-account path is in the doc now.',
    time: '9:51 AM',
  },
  {
    id: 'reply-5',
    person: 'julia' as const,
    body: 'Perfect, publishing at 9 on Thursday.',
    time: '9:55 AM',
  },
];

/** Inline replies with the curved rail and the "N more replies" pill. */
export function ChannelThreadDemo() {
  let root!: HTMLDivElement;
  let frame: HTMLDivElement | undefined;
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'root',
      person: 'julia',
      body: 'Can we confirm the announcement wording before Thursday?',
      time: '9:30 AM',
      documentId: 'plan',
    },
    ...threadReplies.map((reply) => ({ ...reply, replyTo: 'root' })),
    {
      id: 'next',
      person: 'valentina',
      body: 'Northwind wants a demo of the team workspace next week. Who can take it?',
      time: '10:02 AM',
    },
  ]);
  w.open('messages', 'launch');
  const [aim, setAim] = createSignal(false);
  const expand = () => {
    setAim(false);
    frame
      ?.querySelector<HTMLButtonElement>(
        '[data-thread-id="root"] .sample-thread-expand'
      )
      ?.click();
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 2,
    reset: () => {},
    reduced: () => {},
    delay: (step) => (step === 1 ? 1000 : 1500),
    advance: (step) => {
      if (step === 1) setAim(true);
      if (step === 2) expand();
    },
  });
  const pointer = createCursorTarget(
    () => frame,
    () => (aim() ? '[data-thread-id="root"] .sample-thread-expand' : undefined)
  );
  return (
    <div ref={frame} class="channel-demo-frame">
      <ProductDemo
        ref={(el) => (root = el)}
        label="Read a thread inline and expand the rest"
        onInteract={() => {
          setAim(false);
          playback.pause();
        }}
        height={600}
        mobileHeight={700}
      >
        <ProductWorkspace workspace={w} />
      </ProductDemo>
      <Show when={pointer()}>
        {(p) => (
          <DemoCursor
            label="Jacob"
            class="channel-demo-cursor"
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

/** @Macro answers in the channel from what the team has said and linked. */
export function ChannelAgentDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  const initial = [
    {
      id: 'invite',
      person: 'teo' as const,
      body: 'Invite fix is up for review. New and existing accounts both land in the right team now.',
      time: '9:20 AM',
    },
    {
      id: 'announcement',
      person: 'julia' as const,
      body: 'Announcement is drafted. I’ll send it as soon as the invite fix merges.',
      time: '9:24 AM',
    },
    {
      id: 'catchup',
      person: 'jacob' as const,
      body: '@[Macro](demo-mention:macro) I was out yesterday. Catch me up on the launch: who owns what, and is anything blocked?',
      time: '9:28 AM',
    },
  ];
  w.setData('channels', (c) => c.id === 'launch', 'messages', initial);
  w.open('messages', 'launch');
  const finish = () => {
    w.setData('channels', (c) => c.id === 'launch', 'messages', [
      ...initial,
      {
        id: 'agent-summary',
        person: 'macro',
        body: 'Launch is Thursday at 9. Teo’s invite fix is in review, Julia’s announcement is ready and waiting on that fix, and the launch checklist is yours. Nothing else is blocked.',
        time: '9:28 AM',
        taskIds: ['invite', 'announcement', 'checklist'],
      },
    ]);
    // Like a new message arriving, keep the latest reply in view.
    requestAnimationFrame(() => {
      const log = root?.querySelector<HTMLElement>('[role="log"]');
      if (log) log.scrollTop = log.scrollHeight;
    });
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 1,
    reset: () => {},
    reduced: finish,
    delay: () => 1300,
    advance: finish,
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Ask the Macro agent to catch you up in the channel"
      onInteract={playback.pause}
      height={600}
      mobileHeight={720}
    >
      <ProductWorkspace workspace={w} />
    </ProductDemo>
  );
}
