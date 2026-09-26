import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import EmailIcon from '@phosphor/envelope.svg';
import DocumentIcon from '@phosphor/file-text.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import HomeIcon from '@phosphor/house.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import SplitIcon from '@phosphor/sidebar-simple.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import SheetIcon from '@phosphor/table.svg';
import HomeFillIcon from '@phosphor-fill/house-fill.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { Tabs } from '@ui/components/Tabs';
import {
  createSignal,
  For,
  Index,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { DemoPage } from '../core/workspace-demo';
import { createWorkspaceDemo } from '../primitives/createWorkspaceDemo';
import { NavGlyph, type NavIcon } from './DemoNavGlyph';

// Keep the unfinished interactive workspace available for a later polish pass.
const FULL_DEMO_ENABLED = false;

const loadWorkspace = () => import('./HomepageWorkspace');
const HomepageWorkspace = lazy(loadWorkspace);
const HomepageWorkspaceList = lazy(async () => ({
  default: (await import('./HomepageWorkspaceList')).HomepageWorkspaceList,
}));

import { HomepagePersonAvatar } from './HomepageConversation';
import './homepage-sidebar.css';

type Destination =
  | 'documents'
  | 'email'
  | 'messages'
  | 'tasks'
  | 'agents'
  | 'calendar'
  | 'crm';

const CALLOUTS: readonly {
  id: Destination;
  label: string;
  description?: string;
  icon: NavIcon;
  side: 'left' | 'right';
}[] = [
  {
    id: 'documents',
    label: 'Docs',
    icon: FolderIcon,
    side: 'left',
  },
  {
    id: 'email',
    label: 'Email',
    icon: EmailIcon,
    side: 'left',
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: ChatIcon,
    side: 'left',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: TaskIcon,
    side: 'right',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: CalendarIcon,
    side: 'left',
  },
  {
    id: 'agents',
    label: 'External agents',
    description: 'Cursor, Claude, ChatGPT, Hermes, ACP, etc.',
    icon: AgentIcon,
    side: 'right',
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: BuildingsIcon,
    side: 'left',
  },
];

const RECENT_ITEMS: readonly {
  label: string;
  icon: NavIcon;
  kind: Destination;
  unread?: boolean;
}[] = [
  {
    label: 'launch',
    icon: HashIcon,
    kind: 'messages',
    unread: true,
  },
  {
    label: 'Thursday’s launch',
    icon: EmailIcon,
    kind: 'email',
    unread: true,
  },
  {
    label: 'Q3 launch plan',
    icon: DocumentIcon,
    kind: 'documents',
  },
  {
    label: 'Prepare the launch checklist',
    icon: TaskIcon,
    kind: 'tasks',
  },
  {
    label: 'Cursor · Fix the deploy pipeline',
    icon: AgentIcon,
    kind: 'agents',
  },
];

const CREATE_ITEMS = [
  { label: 'Email', icon: EmailIcon, page: 'email' },
  { label: 'Agent', icon: AgentIcon, page: 'agents' },
  {
    label: 'Document',
    icon: DocumentIcon,
    page: 'documents',
  },
  { label: 'Task', icon: TaskIcon, page: 'tasks' },
  { label: 'Message', icon: ChatIcon, page: 'messages' },
  {
    label: 'Spreadsheet',
    icon: SheetIcon,
    page: 'spreadsheet',
  },
] as const;

/** A static Home breakdown; the retained full demo has local navigation. */
export function HomepageSidebar() {
  let stage!: HTMLDivElement;
  let measurePointers = () => {};
  const demo = createWorkspaceDemo();
  const [expandedRequested, setExpanded] = createSignal(false);
  const expanded = () => FULL_DEMO_ENABLED && expandedRequested();
  const [opened, setOpened] = createSignal(false);
  const changeMode = (value: string) => {
    const next = value === 'demo';
    if (
      next &&
      (!FULL_DEMO_ENABLED || !window.matchMedia('(min-width: 1000px)').matches)
    )
      return;
    if (next) setOpened(true);
    setExpanded(next);
    setHighlighted(undefined);
  };
  const navigate = (page: DemoPage) => {
    if (!expanded()) return;
    setSearching(false);
    setQuery('');
    demo.open(page);
  };
  const [highlighted, setHighlighted] = createSignal<Destination>();
  const [searching, setSearching] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    stage
      .querySelector<HTMLButtonElement>('.homepage-sidebar-search')
      ?.focus({ preventScroll: true });
  };
  const matches = (label: string) =>
    label.toLowerCase().includes(query().trim().toLowerCase());
  const toggleSearch = () => {
    setSearching(!searching());
    setQuery('');
    if (searching())
      stage
        .querySelector<HTMLInputElement>(
          expanded()
            ? '.homepage-sidebar-demo-list input'
            : '.homepage-sidebar-breakdown-list input'
        )
        ?.focus({ preventScroll: true });
  };
  const [pointers, setPointers] = createSignal<
    { id: Destination; path: string; x: number; y: number }[]
  >([]);

  onMount(() => {
    const measure = () => {
      if (expanded()) return;
      const mobile = window.matchMedia('(max-width: 799px)').matches;
      const bounds = stage.getBoundingClientRect();
      const scale = stage.clientWidth / bounds.width;
      setPointers(
        CALLOUTS.flatMap((item) => {
          const label = stage.querySelector(`[data-callout="${item.id}"]`);
          const target = stage.querySelector(
            mobile
              ? `[data-rail-target="${item.id}"]`
              : `[data-pointer-target="${item.id}"]`
          );
          if (!label || !target) return [];
          const a = (
            mobile ? (label.querySelector('span') ?? label) : label
          ).getBoundingClientRect();
          const b = target.getBoundingClientRect();
          const left = mobile || item.side === 'left';
          const x1 =
            ((left ? a.right + 14 : a.left - 14) - bounds.left) * scale;
          const y1 = (a.top + a.height / 2 - bounds.top) * scale;
          const x2 = ((left ? b.left - 8 : b.right + 8) - bounds.left) * scale;
          const y2 = (b.top + b.height / 2 - bounds.top) * scale;
          const firstBend = x1 + (x2 - x1) * 0.25;
          const secondBend = x1 + (x2 - x1) * 0.75;
          return [
            {
              id: item.id,
              path: `M${x1} ${y1} H${firstBend} L${secondBend} ${y2} H${x2}`,
              x: x2,
              y: y2,
            },
          ];
        })
      );
    };
    measurePointers = measure;
    const desktop = window.matchMedia('(min-width: 1000px)');
    const onViewport = () => {
      if (!desktop.matches) setExpanded(false);
      measure();
    };
    desktop.addEventListener('change', onViewport);
    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    stage
      .querySelectorAll('[data-callout]')
      .forEach((label) => resize.observe(label));
    measure();
    onCleanup(() => {
      resize.disconnect();
      desktop.removeEventListener('change', onViewport);
    });
  });

  return (
    <section
      id="workspace-sidebar"
      class="homepage-sidebar-section workspace-demo"
      aria-label="All your work, one sidebar"
      data-demo-expanded={expanded()}
      data-main-only={demo.page() === 'calendar'}
    >
      <div ref={stage} class="homepage-sidebar-stage">
        <div
          class="homepage-sidebar-window glass"
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'width' &&
              !expanded()
            )
              measurePointers();
          }}
        >
          <span class="homepage-sidebar-line-anchor" aria-hidden="true" />
          <div class="homepage-sidebar-rail">
            <Show
              when={expanded()}
              fallback={
                <span
                  class="homepage-sidebar-create"
                  role="img"
                  aria-label="Create"
                >
                  <PlusIcon />
                </span>
              }
            >
              <Dropdown placement="right-start" gutter={10} modal={false}>
                <Dropdown.Trigger
                  class="homepage-sidebar-create"
                  aria-label="Create in the workspace preview"
                >
                  <PlusIcon />
                </Dropdown.Trigger>
                <Dropdown.Content
                  class="homepage-sidebar-create-menu workspace-demo"
                  aria-label="Create"
                >
                  <Dropdown.Group>
                    <For each={CREATE_ITEMS}>
                      {(item) => (
                        <Dropdown.Item onClick={() => navigate(item.page)}>
                          <NavGlyph icon={item.icon} class="size-4" />
                          <span>{item.label}</span>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                  <p>Open an interactive example</p>
                </Dropdown.Content>
              </Dropdown>
            </Show>
            <Dynamic
              component={expanded() ? 'button' : 'span'}
              type={expanded() ? 'button' : undefined}
              class="homepage-sidebar-search"
              role={expanded() ? undefined : 'img'}
              aria-label="Search"
              aria-pressed={expanded() ? searching() : undefined}
              onClick={expanded() ? toggleSearch : undefined}
            >
              <SearchIcon aria-hidden="true" />
            </Dynamic>
            <Dynamic
              component={expanded() ? 'button' : 'span'}
              type={expanded() ? 'button' : undefined}
              class="homepage-sidebar-home"
              role={expanded() ? undefined : 'img'}
              aria-label="Home"
              data-active={!expanded() || demo.navigation() === 'home'}
              onClick={expanded() ? () => navigate('home') : undefined}
            >
              <NavGlyph
                icon={HomeIcon}
                iconActive={HomeFillIcon}
                filled
                class="size-6"
              />
            </Dynamic>
            <For each={CALLOUTS}>
              {(item) => (
                <Dynamic
                  component={expanded() ? 'button' : 'span'}
                  type={expanded() ? 'button' : undefined}
                  role={expanded() ? undefined : 'img'}
                  aria-label={item.label}
                  aria-current={
                    expanded() && demo.navigation() === item.id
                      ? 'page'
                      : undefined
                  }
                  onClick={expanded() ? () => navigate(item.id) : undefined}
                  data-rail-target={item.id}
                  data-highlighted={highlighted() === item.id}
                  data-pointer-target={
                    item.side === 'left' ? item.id : undefined
                  }
                  onMouseEnter={() => setHighlighted(item.id)}
                  onMouseLeave={() => setHighlighted(undefined)}
                  onFocus={() => setHighlighted(item.id)}
                  onBlur={() => setHighlighted(undefined)}
                >
                  <NavGlyph icon={item.icon} class="size-6" />
                  <Show when={item.id === 'email' || item.id === 'messages'}>
                    <span class="homepage-sidebar-dot" />
                  </Show>
                </Dynamic>
              )}
            </For>
            <span class="homepage-sidebar-profile">
              <HomepagePersonAvatar person="jacob" />
            </span>
          </div>
          <div class="homepage-sidebar-list">
            <div
              class="homepage-sidebar-breakdown-list"
              inert={expanded()}
              aria-hidden={expanded()}
            >
              <div class="homepage-sidebar-heading">
                <Show when={searching()} fallback={<span>Home</span>}>
                  <input
                    type="search"
                    aria-label="Search example items"
                    placeholder="Search your work…"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeSearch();
                    }}
                  />
                </Show>
                <SplitIcon aria-hidden="true" />
              </div>
              <p class="homepage-sidebar-period">Last few minutes</p>
              <div class="homepage-sidebar-recents">
                <For each={RECENT_ITEMS}>
                  {(item) => (
                    <div
                      data-search-match={matches(item.label)}
                      data-highlighted={highlighted() === item.kind}
                      data-pointer-target={
                        item.kind === 'tasks' || item.kind === 'agents'
                          ? item.kind
                          : undefined
                      }
                      onMouseEnter={() => setHighlighted(item.kind)}
                      onMouseLeave={() => setHighlighted(undefined)}
                    >
                      <NavGlyph icon={item.icon} class="size-5" />
                      <span>{item.label}</span>
                      <Show when={item.unread}>
                        <i class="homepage-sidebar-dot" />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <p class="homepage-sidebar-period">Earlier today</p>
              <div
                class="homepage-sidebar-older"
                data-search-match={matches('Customers to reach')}
              >
                <SheetIcon aria-hidden="true" />
                <span>Customers to reach</span>
              </div>
              <div
                class="homepage-sidebar-older"
                data-search-match={matches('Julia Launch announcement')}
              >
                <HomepagePersonAvatar person="julia" />
                <span>Julia · Launch announcement</span>
              </div>
              <div class="homepage-sidebar-list-fade" aria-hidden="true" />
            </div>
            <div
              class="homepage-sidebar-demo-list"
              inert={!expanded() || demo.page() === 'calendar'}
              aria-hidden={!expanded() || demo.page() === 'calendar'}
            >
              <Show when={FULL_DEMO_ENABLED && opened()}>
                <Suspense>
                  <HomepageWorkspaceList
                    demo={demo}
                    searching={searching()}
                    query={query()}
                    onSearch={setQuery}
                    onCloseSearch={closeSearch}
                  />
                </Suspense>
              </Show>
            </div>
          </div>
          <div
            class="homepage-sidebar-main"
            inert={!expanded()}
            aria-hidden={!expanded()}
          >
            <Show when={FULL_DEMO_ENABLED && opened()}>
              <Suspense
                fallback={
                  <div class="grid h-full place-items-center text-sm text-ink-muted">
                    Loading demo…
                  </div>
                }
              >
                <HomepageWorkspace demo={demo} />
              </Suspense>
            </Show>
          </div>
        </div>
        <svg class="homepage-sidebar-pointers" aria-hidden="true" fill="none">
          <Index each={pointers()}>
            {(pointer) => (
              <g data-highlighted={highlighted() === pointer().id}>
                <path d={pointer().path} pathLength="1" />
                <polygon
                  points={`${pointer().x},${pointer().y - 3} ${pointer().x + 3},${pointer().y} ${pointer().x},${pointer().y + 3} ${pointer().x - 3},${pointer().y}`}
                />
              </g>
            )}
          </Index>
        </svg>
        <div
          class="homepage-sidebar-callouts"
          inert={expanded()}
          aria-hidden={expanded()}
        >
          <For each={CALLOUTS}>
            {(item) => (
              <div
                data-callout={item.id}
                data-side={item.side}
                data-highlighted={highlighted() === item.id}
                onMouseEnter={() => setHighlighted(item.id)}
                onMouseLeave={() => setHighlighted(undefined)}
              >
                <span>{item.label}</span>
                <Show when={item.description}>
                  <p>{item.description}</p>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={FULL_DEMO_ENABLED}>
        <div
          class="homepage-sidebar-mode"
          onPointerEnter={() => void HomepageWorkspace.preload()}
          onFocusIn={() => void HomepageWorkspace.preload()}
        >
          <div class="homepage-sidebar-mode-track">
            <Tabs
              aria-label="Workspace preview mode"
              list={[
                { value: 'breakdown', label: 'Breakdown' },
                { value: 'demo', label: 'Full Demo' },
              ]}
              value={expanded() ? 'demo' : 'breakdown'}
              onChange={changeMode}
            />
          </div>
        </div>
      </Show>
    </section>
  );
}
