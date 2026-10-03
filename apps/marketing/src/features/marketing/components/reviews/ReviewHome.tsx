import Reply from '@phosphor/arrow-bend-up-left.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import Buildings from '@phosphor/buildings.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Chats from '@phosphor/chats-circle.svg';
import Check from '@phosphor/check.svg';
import Envelope from '@phosphor/envelope.svg';
import Folder from '@phosphor/folder-simple.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Search from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import Sparkle from '@phosphor/sparkle.svg';
import X from '@phosphor/x.svg';
import HouseFill from '@phosphor-fill/house-fill.svg';
import { Button } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { WorkspaceView } from '../../core/dummy-workspace';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewSidebar } from '../DemoViewSidebar';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { WorkspaceAgents } from '../workspace/WorkspaceAgents';
import { PrIcon, PullRequestView } from './ReviewPullRequest';
import {
  type DemoPullRequest,
  invitePr,
  onboardingPr,
} from './review-fixtures';

/** One single-line HomeListEntity row and the item it opens. */
export type HomeRow = {
  id: string;
  kind: 'pr' | 'thread' | 'channel' | 'dm' | 'task' | 'email' | 'comment';
  /** Plain label, also the row's accessible name. */
  label: string;
  /** Hover timestamp. */
  time: string;
  unread?: boolean;
  pr?: DemoPullRequest;
  person?: HomepagePersonId;
  open?: { view: WorkspaceView; id: string; thread?: string };
};

export type HomeGroup = { label: string; rows: HomeRow[] };

export const reviewRequestRow: HomeRow = {
  id: 'pr-491',
  kind: 'pr',
  label: `${invitePr.title} #${invitePr.number}`,
  time: '11:36 AM',
  unread: true,
  pr: invitePr,
};

const row = {
  engineers: {
    id: 'channel-engineers',
    kind: 'channel',
    label: 'engineers',
    time: '11:17 AM',
    unread: true,
    open: { view: 'messages', id: 'engineers' },
  },
  dm: {
    id: 'dm-teo',
    kind: 'dm',
    label: 'Teo',
    time: '11:14 AM',
    unread: true,
    person: 'teo',
    open: { view: 'messages', id: 'dm-teo' },
  },
  onboarding: {
    id: 'pr-479',
    kind: 'pr',
    label: `${onboardingPr.title} #${onboardingPr.number}`,
    time: '11:05 AM',
    pr: onboardingPr,
  },
  email: {
    id: 'email-dana',
    kind: 'email',
    label: 'Next steps for our team',
    time: '9:41 AM',
    unread: true,
    open: { view: 'email', id: 'dana' },
  },
  task: {
    id: 'task-checklist',
    kind: 'task',
    label: 'Prepare the launch checklist',
    time: '9:38 AM',
    unread: true,
    open: { view: 'tasks', id: 'checklist' },
  },
  thread: {
    id: 'thread-launch',
    kind: 'thread',
    label: 'Julia in #launch',
    time: '9:35 AM',
    open: { view: 'messages', id: 'launch', thread: 'm1' },
  },
  comment: {
    id: 'comment-plan',
    kind: 'comment',
    label: 'Valentina commented on Q3 launch plan',
    time: '8:52 AM',
    open: { view: 'documents', id: 'plan' },
  },
  invite: {
    id: 'task-invite',
    kind: 'task',
    label: 'Fix the team invite handoff',
    time: '8:31 AM',
    open: { view: 'tasks', id: 'invite' },
  },
} satisfies Record<string, HomeRow>;

/** Hero: review requests and PR updates among messages, tasks, and email. */
export const heroGroups: HomeGroup[] = [
  {
    label: 'Last hour',
    rows: [reviewRequestRow, row.engineers, row.dm, row.onboarding],
  },
  {
    label: 'This morning',
    rows: [row.email, row.task, row.thread, row.comment, row.invite],
  },
];

/** The walkthrough's review request arrives in its own, newest section. */
export const arrivalGroups: HomeGroup[] = [
  { label: 'Last few minutes', rows: [reviewRequestRow] },
  { label: 'Last hour', rows: [row.engineers, row.dm, row.onboarding] },
  { label: 'This morning', rows: [row.email, row.task, row.thread] },
];

/** Local Home state: what's open, read, done, or not yet arrived. */
export function createHomeInbox(options: {
  groups: HomeGroup[];
  initial?: string;
  pending?: string[];
}) {
  const w = createDummyWorkspace('home');
  w.setData('documents', (doc) => doc.id === 'plan', 'comments', [
    {
      id: 'plan-screenshots',
      person: 'valentina',
      body: 'Can we add the mobile screenshots to the checklist? They’re ready.',
      time: '8:52 AM',
    },
  ]);
  const [active, setActive] = createSignal<string>();
  const [pr, setPr] = createSignal<DemoPullRequest>();
  const [pane, setPane] = createSignal<'list' | 'detail'>('list');
  const [read, setRead] = createSignal<string[]>([]);
  const [done, setDone] = createSignal<string[]>([]);
  const [pending, setPending] = createSignal(options.pending ?? []);
  const [toast, setToast] = createSignal<string>();
  const all = options.groups.flatMap((group) => group.rows);
  const shown = (item: HomeRow) =>
    !done().includes(item.id) && !pending().includes(item.id);
  // Fixture objects keep their identity, so rows aren't re-created.
  const rowsOf = (group: HomeGroup) => group.rows.filter(shown);
  const groups = createMemo(() =>
    options.groups.filter((group) => group.rows.some(shown))
  );
  const rows = () => all.filter(shown);
  const unread = (item: HomeRow) => !!item.unread && !read().includes(item.id);
  const open = (item: HomeRow) =>
    batch(() => {
      setPr(item.pr);
      if (item.pr || !item.open) w.open('home');
      else {
        w.openItem(item.open.view, item.open.id);
        if (item.open.thread) w.setChannelThread(item.open.thread);
      }
      setRead((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
      setActive(item.id);
      setPane('detail');
    });
  const home = () =>
    batch(() => {
      setPr(undefined);
      w.open('home');
      setActive(undefined);
      setPane('list');
    });
  /** Mark done (E): the row leaves Home and the next item opens. */
  const markDone = (id = active()) => {
    if (!id) return;
    const visible = rows();
    const index = visible.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = visible[index + 1] ?? visible[index - 1];
    batch(() => {
      setDone((ids) => [...ids, id]);
      setToast(id);
      if (next) open(next);
      else home();
      setPane('list');
    });
  };
  const undo = () => {
    const id = toast();
    if (!id) return;
    batch(() => {
      setDone((ids) => ids.filter((item) => item !== id));
      setToast(undefined);
    });
  };
  // Items' own Home breadcrumbs return to the list.
  createEffect(() => {
    if (w.contentView() === 'home' && !pr() && active()) {
      setActive(undefined);
      setPane('list');
    }
  });
  if (options.initial) {
    const initial = all.find((item) => item.id === options.initial);
    if (initial) {
      open(initial);
      setPane('list');
    }
  }
  return {
    w,
    active,
    pr,
    pane,
    groups,
    unread,
    open,
    home,
    markDone,
    undo,
    toast,
    dismissToast: () => setToast(undefined),
    rowsOf,
    reveal: (id: string) => {
      if (pending().includes(id))
        setPending((ids) => ids.filter((x) => x !== id));
    },
  };
}

export type HomeInboxState = ReturnType<typeof createHomeInbox>;

function RowIcon(props: { row: HomeRow }) {
  const icons = {
    thread: Reply,
    channel: Hash,
    task: ListChecks,
    email: Envelope,
    comment: ChatTeardrop,
  } as const;
  return (
    <Switch>
      <Match when={props.row.pr}>
        {(pr) => (
          <ViewSidebar.Icon>
            <PrIcon status={pr().status} />
          </ViewSidebar.Icon>
        )}
      </Match>
      <Match when={props.row.person}>
        {(person) => (
          <img
            class="size-5 shrink-0 rounded-full"
            src={homepagePeople[person()].photo}
            alt=""
          />
        )}
      </Match>
      <Match when={props.row.kind in icons}>
        <ViewSidebar.Icon>
          <Dynamic component={icons[props.row.kind as keyof typeof icons]} />
        </ViewSidebar.Icon>
      </Match>
    </Switch>
  );
}

/** "Julia in #launch", "Valentina commented on Q3 launch plan". */
function ActorTitle(props: { label: string; joiner: string }) {
  const parts = () => props.label.split(props.joiner);
  return (
    <span class="flex min-w-0 items-center">
      <span class="max-w-1/2 shrink-0 truncate">{parts()[0]}</span>
      <span class="shrink-0 whitespace-pre">{props.joiner}</span>
      <span class="min-w-0 truncate">{parts()[1]}</span>
    </span>
  );
}

function RowTitle(props: { row: HomeRow }) {
  return (
    <Switch fallback={props.row.label}>
      <Match when={props.row.pr}>
        {(pr) => (
          <>
            {pr().title}{' '}
            <span class="font-normal text-ink-extra-muted">#{pr().number}</span>
          </>
        )}
      </Match>
      <Match when={props.row.kind === 'thread'}>
        <ActorTitle label={props.row.label} joiner=" in " />
      </Match>
      <Match when={props.row.kind === 'comment'}>
        <ActorTitle label={props.row.label} joiner=" commented on " />
      </Match>
    </Switch>
  );
}

/** Home's list rail: "Home", New chat, then date sections of one-line items. */
export function HomeSidebar(props: {
  inbox: HomeInboxState;
  arriving?: string;
}) {
  const inbox = props.inbox;
  return (
    <ViewSidebar.Root aria-label="Home" class="review-home-sidebar">
      <ViewSidebar.Header>
        <ViewSidebar.Title>Home</ViewSidebar.Title>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <ViewSidebar.Action onClick={inbox.home}>
          <ViewSidebar.Icon>
            <Plus />
          </ViewSidebar.Icon>
          New chat
        </ViewSidebar.Action>
      </ViewSidebar.Primary>
      <ViewSidebar.Content>
        <For each={inbox.groups()}>
          {(group) => (
            <section>
              <p class="review-home-group">{group.label}</p>
              <ViewSidebar.Nav>
                <For each={inbox.rowsOf(group)}>
                  {(item) => (
                    <ViewSidebar.Item
                      class="review-home-row"
                      active={inbox.active() === item.id}
                      data-home-row={item.id}
                      data-arriving={
                        props.arriving === item.id ? 'true' : undefined
                      }
                      aria-label={item.label}
                      onClick={() => inbox.open(item)}
                    >
                      <RowIcon row={item} />
                      <span
                        class="block min-w-0 flex-1 truncate font-normal"
                        classList={{ 'text-ink': inbox.unread(item) }}
                      >
                        <RowTitle row={item} />
                      </span>
                      <span class="review-home-time" aria-hidden="true">
                        {item.time}
                      </span>
                      <Show when={inbox.unread(item)}>
                        <span
                          role="img"
                          aria-label="Unread"
                          class="size-1.5 shrink-0 rounded-full bg-accent"
                        />
                      </Show>
                    </ViewSidebar.Item>
                  )}
                </For>
              </ViewSidebar.Nav>
            </section>
          )}
        </For>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}

/** What Home's main pane shows: the opened item, or the new-chat start. */
export function HomeDetail(props: { inbox: HomeInboxState }) {
  const inbox = props.inbox;
  return (
    <Switch fallback={<ProductWorkspace workspace={inbox.w} />}>
      <Match when={inbox.pr()}>
        {(pr) => (
          <PullRequestView
            pr={pr()}
            crumb={{ label: 'Home', onClick: inbox.home }}
          />
        )}
      </Match>
      <Match when={inbox.w.contentView() === 'home'}>
        <WorkspaceAgents workspace={inbox.w} home />
      </Match>
    </Switch>
  );
}

/** The toast Mark done raises, with its Undo action. */
export function DoneToast(props: { inbox: HomeInboxState }) {
  return (
    <Show when={props.inbox.toast()} keyed>
      <div class="review-toast" role="status">
        <span class="review-toast-icon">
          <Check class="size-3.5" />
        </span>
        <span class="min-w-0 flex-1 truncate font-semibold">
          Marked as done
        </span>
        <Button size="sm" variant="plain" onClick={props.inbox.undo}>
          <ArrowCounterClockwise class="size-3.5" />
          Undo
        </Button>
        <Button
          size="icon-sm"
          variant="plain"
          label="Dismiss"
          onClick={props.inbox.dismissToast}
        >
          <X />
        </Button>
      </div>
    </Show>
  );
}

/** E marks the open item done, as in Home; typing in a composer is exempt. */
export function markDoneOnE(inbox: HomeInboxState, onKey?: () => void) {
  return (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      event.key.toLowerCase() !== 'e' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (!inbox.active()) return;
    event.preventDefault();
    onKey?.();
    inbox.markDone();
  };
}

const RAIL = [
  Folder,
  Envelope,
  Chats,
  ListChecks,
  Calendar,
  Sparkle,
  Buildings,
];

/** The app's left rail with Home selected; the hero only explores Home. */
export function HomeRail(): JSX.Element {
  return (
    <div class="dummy-rail review-rail" aria-hidden="true">
      <span class="review-rail-button" data-create="true">
        <Plus class="size-5" />
      </span>
      <span class="review-rail-button">
        <Search class="size-5" />
      </span>
      <span class="review-rail-nav">
        <span class="review-rail-button" data-active="true">
          <HouseFill class="size-5" />
        </span>
        <For each={RAIL}>
          {(icon) => (
            <span class="review-rail-button">
              <Dynamic component={icon} class="size-5" />
            </span>
          )}
        </For>
      </span>
      <span class="min-h-0 flex-1" />
      <img
        src={homepagePeople.jacob.photo}
        alt=""
        class="size-8 rounded-full"
      />
    </div>
  );
}
