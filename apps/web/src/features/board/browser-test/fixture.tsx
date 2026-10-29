import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@app/index.css';
import { useHotKeyRoot, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { Button } from '@ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { MessageStack } from '../components/message-stack';
import { SpeechBubble } from '../components/speech-bubble';
import {
  type BoardCapabilities,
  BoardProvider,
  type BoardSourceState,
  type BoardStorage,
} from '../context/board-context';
import type { BoardAuthor, BoardItem } from '../core/item';
import {
  BOARD_VARIANTS,
  type BoardVariant,
  DEFAULT_BOARD_VARIANT,
} from '../core/variants';
import { BoardView } from '../views/board-view';
import {
  arrivingMessage,
  FIXTURE_NOW,
  fixtureItems,
  OLDER_PAGES,
  olderActivity,
} from './fixture-data';

const STORAGE_KEY = 'macro:board:fixture';
/** Long enough to see the end of a list say it is loading. */
const OLDER_DELAY_MS = 400;
const HUES = ['blue', 'violet', 'teal', 'orange', 'pink', 'green', 'cyan'];

function hue(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

/** Initials on a stable color; agents get a sparkle-like mark. */
function FixtureAvatar(props: { author: BoardAuthor; size: number }) {
  const initials = () =>
    props.author.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  return (
    <span
      aria-hidden="true"
      class="flex shrink-0 items-center justify-center rounded-full font-semibold text-[color-mix(in_oklch,var(--avatar-hue)_15%,white)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--avatar-hue)_40%,transparent)]"
      style={{
        '--avatar-hue': `var(--color-${props.author.kind === 'agent' ? 'purple' : hue(props.author.id)})`,
        background: 'color-mix(in oklch, var(--avatar-hue) 70%, black)',
        width: `${props.size}px`,
        height: `${props.size}px`,
        'font-size': `${Math.max(8, Math.round(props.size * 0.38))}px`,
      }}
    >
      {props.author.kind === 'agent' ? '✦' : initials()}
    </span>
  );
}

/** Stands in for the channel, email or document the app opens here. */
function FixtureDetail(props: { item: BoardItem | undefined }) {
  return (
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <Show when={props.item}>
        {(item) => (
          <>
            <p class="text-xs text-ink-muted">
              Fixture preview — the app renders the real{' '}
              {item().kind.replace('-', ' ')} here.
            </p>
            <MessageStack
              messages={item().messages}
              showNames
              Avatar={FixtureAvatar}
              lines={3}
              class="max-w-160"
            />
            <SpeechBubble text="Type a reply…" tone="system" />
          </>
        )}
      </Show>
    </div>
  );
}

function initialVariant(): BoardVariant {
  const hash = window.location.hash.slice(1);
  return (
    BOARD_VARIANTS.find((variant) => variant === hash) ?? DEFAULT_BOARD_VARIANT
  );
}

function Fixture() {
  const [dark, setDark] = createSignal(
    new URLSearchParams(window.location.search).get('theme') !== 'light'
  );
  const applyTheme = (isDark: boolean) => {
    setDark(isDark);
    const theme = isDark ? macroDarkTheme : macroLightTheme;
    for (const [name, value] of Object.entries(themeCssVars(theme)))
      document.documentElement.style.setProperty(name, value);
    document.documentElement.dataset.themeLight = String(!isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  };
  onMount(() => applyTheme(dark()));

  const [now, setNow] = createSignal(FIXTURE_NOW);
  const [items, setItems] = createSignal(fixtureItems());
  const [state, setState] = createSignal<BoardSourceState>('ready');
  const [variant, setVariant] = createSignal(initialVariant());
  onMount(() => {
    const follow = () => setVariant(initialVariant());
    window.addEventListener('hashchange', follow);
    onCleanup(() => window.removeEventListener('hashchange', follow));
  });
  const [olderPages, setOlderPages] = createSignal(0);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const loadOlder = () => {
    if (loadingOlder() || olderPages() >= OLDER_PAGES) return;
    setLoadingOlder(true);
    setTimeout(() => {
      setItems((previous) => [...previous, ...olderActivity(olderPages())]);
      setOlderPages((pages) => pages + 1);
      setLoadingOlder(false);
    }, OLDER_DELAY_MS);
  };
  useHotKeyRoot();
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('board-fixture');
  let boardRoot!: HTMLDivElement;
  onMount(() => attachHotkeys(boardRoot));
  const [events, setEvents] = createSignal<string[]>([]);
  const record = (event: string) =>
    setEvents((previous) => [event, ...previous].slice(0, 4));
  let arrivals = 0;

  const storage: BoardStorage = {
    read: () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : undefined;
    },
    write: (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  };

  const capabilities: BoardCapabilities = {
    source: {
      items: () => (state() === 'ready' ? items() : []),
      state,
      retry: () => setState('ready'),
      older: {
        hasMore: () => olderPages() < OLDER_PAGES,
        loading: loadingOlder,
        load: loadOlder,
      },
    },
    now,
    storage,
    Avatar: FixtureAvatar,
    Detail: (props) => (
      <FixtureDetail
        item={items().find((item) => item.key === props.itemKey)}
      />
    ),
    open: (key) => {
      record(`opened ${key}`);
      return 'modal';
    },
    close: (key) => record(`closed ${key}`),
    openInSplit: (key, options) =>
      record(`split ${key}${options.newSplit ? ' (new)' : ''}`),
  };

  const arrive = () => {
    // A minute passes per arrival, so an item closed after one arrival
    // reopens on the next.
    const at = now() + 60_000;
    setNow(at);
    const { key, message } = arrivingMessage(at, arrivals++);
    setItems((previous) =>
      previous.map((item) =>
        item.key === key
          ? {
              ...item,
              messages: [...item.messages, message].slice(-4),
              lastActivityAt: message.at,
              unreadCount: item.unreadCount + 1,
            }
          : item
      )
    );
    record(`new message in ${key}`);
  };

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <div
        data-fixture-controls=""
        class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted px-3 py-2 text-xs"
      >
        <span class="font-semibold">Board fixture</span>
        <Button size="sm" variant="secondary" onClick={arrive}>
          New message
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setNow((value) => value + 3 * 3_600_000)}
        >
          +3 hours
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setState((value) => (value === 'loading' ? 'ready' : 'loading'))
          }
        >
          Toggle loading
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
          }}
        >
          Reset memory
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => applyTheme(!dark())}
        >
          {dark() ? 'Light theme' : 'Dark theme'}
        </Button>
        <ol
          aria-label="Fixture events"
          class="ml-auto flex gap-3 text-ink-muted"
        >
          <For each={events()}>{(event) => <li>{event}</li>}</For>
        </ol>
      </div>
      <div ref={boardRoot} class="flex min-h-0 flex-1">
        <BoardProvider value={capabilities}>
          <BoardView
            variant={variant()}
            onVariantChange={(next) => {
              setVariant(next);
              window.location.hash = next;
            }}
            hotkeys={{ scopeId: hotkeyScope, enabled: () => true }}
          />
        </BoardProvider>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
