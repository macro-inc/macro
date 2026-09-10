import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { seedMockDisplayNames } from '@core/user/displayName';
import type { EditorType } from '@lexical-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { type AutoplayHooks, type AutoplayScript, runAutoplay, runDocReveal } from './autoplay';
import { type ChannelScene, ChannelWindow, EmailCard } from './chrome';
import './embed.css';
import { SAMPLE_USER_NAMES, SAMPLE_USERS, sampleEntities } from './sampleData';

// Register decorator components (mention pills, etc.) — must run before any
// editor mounts, otherwise inserted mentions have no renderer.
initializeLexical();

// Resolve mention avatars/names locally so the editor never hits the auth API.
seedMockDisplayNames(SAMPLE_USER_NAMES);

// The end of the first bullet ("…it is the real Macro editor.") is intentionally
// absent from the seed — Gab types it in live (see GAB_PHRASE / runDocReveal).
const DOC_ANCHOR = 'Type anywhere in this document —';
const GAB_PHRASE = ' it is the real Macro editor.';

const DOC_MARKDOWN = `# How realtime editing works

Every document is a CRDT backed by its own **Durable Object** in the cloud — a single fast actor that lives microseconds from your keystrokes. Edits merge in order, so the page is always consistent.

## Try it yourself

- ${DOC_ANCHOR}
- Press **@** to mention a teammate, document, or task.
- Press **/** for a command menu, or use markdown shortcuts like \`#\` and \`-\`.
`;

type Mode = 'document' | 'email' | 'channel';

type ModeConfig = {
  type: EditorType;
  initial: string;
  placeholder: string;
  actions: boolean;
  collab: boolean;
  rootClass: string;
  columnClass?: string;
  autoplay?: AutoplayScript;
};

const MODES: Record<Mode, ModeConfig> = {
  document: {
    type: 'markdown',
    initial: DOC_MARKDOWN,
    placeholder: 'Write something… press @ to mention or / for commands',
    actions: true,
    collab: true,
    rootClass: 'live-editor-root',
  },
  email: {
    type: 'chat',
    initial: '',
    placeholder: 'Write your email — press @ to mention a teammate, doc, or task',
    actions: false,
    collab: false,
    rootClass: 'live-editor-root',
    columnClass: 'is-email',
    autoplay: { prefix: 'Handing the launch to ', query: 'sar', suffix: ' — full plan attached.' },
  },
  channel: {
    type: 'chat',
    initial: '',
    placeholder: 'Message #go-to-market — press @ to mention a doc, task, or teammate',
    actions: false,
    collab: false,
    rootClass: 'live-editor-root',
    columnClass: 'is-channel',
    autoplay: { prefix: 'Final plan is locked in ', query: 'Q3', suffix: '' },
  },
};

function resolveMode(): Mode {
  const raw = new URLSearchParams(window.location.search).get('mode');
  if (raw === 'email' || raw === 'channel') return raw;
  return 'document';
}

// Fake remote collaborators, anchored to phrases in the document above. Purely
// decorative — they make the editor read as a live, multiplayer surface.
type Collaborator = {
  name: string;
  color: string;
  find: string;
  mode: 'selection' | 'caret';
};

const COLLABORATORS: Collaborator[] = [
  { name: 'Rahul', color: 'var(--a0)', find: 'lives microseconds from your keystrokes', mode: 'selection' },
  { name: 'Gab', color: 'var(--a2)', find: 'it is the real Macro editor', mode: 'selection' },
  { name: 'Julia', color: 'var(--a4)', find: 'Durable Object', mode: 'caret' },
];

type Rect = { x: number; y: number; w: number; h: number };
type RenderedCursor = {
  name: string;
  color: string;
  rects: Rect[];
  caret?: { x: number; y: number; h: number };
  labelX: number;
  labelY: number;
};

function findPhraseRange(root: HTMLElement, phrase: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: walker iteration
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    const idx = text.indexOf(phrase);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + phrase.length);
      return range;
    }
  }
  return null;
}

function CollabCursors(props: {
  /** Live "someone is typing" caret (viewport rect) + their name/color. */
  typing?: () => { rect: DOMRect; name: string; color: string } | null;
}) {
  let overlay: HTMLDivElement | undefined;
  const [cursors, setCursors] = createSignal<RenderedCursor[]>([]);

  // Convert the typing caret's viewport rect into overlay-local coordinates.
  const typingCaret = () => {
    const t = props.typing?.();
    if (!t || !overlay) return null;
    const base = overlay.getBoundingClientRect();
    return {
      name: t.name,
      color: t.color,
      x: t.rect.left - base.left,
      y: t.rect.top - base.top,
      h: t.rect.height || 18,
    };
  };

  const recompute = () => {
    if (!overlay) return;
    const editor = document.querySelector<HTMLElement>('.live-editor-shell [contenteditable]');
    if (!editor) return;
    const base = overlay.getBoundingClientRect();
    const out: RenderedCursor[] = [];
    for (const c of COLLABORATORS) {
      const range = findPhraseRange(editor, c.find);
      if (!range) continue;
      const list = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!list.length) continue;
      if (c.mode === 'selection') {
        const rects = list.map((r) => ({
          x: r.left - base.left,
          y: r.top - base.top,
          w: r.width,
          h: r.height,
        }));
        out.push({ name: c.name, color: c.color, rects, labelX: rects[0].x, labelY: rects[0].y });
      } else {
        const last = list[list.length - 1];
        const x = last.right - base.left;
        const y = last.top - base.top;
        out.push({ name: c.name, color: c.color, rects: [], caret: { x, y, h: last.height }, labelX: x, labelY: y });
      }
    }
    setCursors(out);
  };

  onMount(() => {
    let tries = 0;
    const tick = () => {
      recompute();
      if (cursors().length < COLLABORATORS.length && tries++ < 50) setTimeout(tick, 100);
    };
    tick();
    const onResize = () => recompute();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  return (
    <div ref={overlay} class="collab-overlay" aria-hidden="true">
      <Show when={typingCaret()}>
        {(c) => (
          <>
            <div
              class="collab-caret"
              style={{
                left: `${c().x}px`,
                top: `${c().y}px`,
                height: `${c().h}px`,
                'background-color': c().color,
              }}
            />
            <div
              class="collab-label"
              style={{
                left: `${c().x}px`,
                top: `${c().y - 15}px`,
                'background-color': c().color,
              }}
            >
              {c().name}
            </div>
          </>
        )}
      </Show>
      <For each={cursors()}>
        {(cursor) => (
          <>
            <For each={cursor.rects}>
              {(r) => (
                <div
                  class="collab-selection"
                  style={{
                    left: `${r.x}px`,
                    top: `${r.y}px`,
                    width: `${r.w}px`,
                    height: `${r.h}px`,
                    'background-color': `color-mix(in srgb, ${cursor.color} 22%, transparent)`,
                    'box-shadow': `inset 0 -2px 0 ${cursor.color}`,
                  }}
                />
              )}
            </For>
            <Show when={cursor.caret}>
              {(c) => (
                <div
                  class="collab-caret"
                  style={{
                    left: `${c().x}px`,
                    top: `${c().y}px`,
                    height: `${c().h}px`,
                    'background-color': cursor.color,
                  }}
                />
              )}
            </Show>
            <div
              class="collab-label"
              style={{
                left: `${cursor.labelX}px`,
                top: `${cursor.labelY - 15}px`,
                'background-color': cursor.color,
              }}
            >
              {cursor.name}
            </div>
          </>
        )}
      </For>
    </div>
  );
}

function LiveEditor(props: { mode: ModeConfig; layout: Mode }) {
  let builder = buildConfig(props.mode.type)
    .namespace('marketing-live-editor')
    .withMentions({
      entities: sampleEntities,
      users: () => SAMPLE_USERS,
      disableMentionTracking: true,
      onCreate: () => {},
    })
    .withEmojis()
    .withHistory()
    .withSkipPreviewFetch();
  if (props.mode.actions) builder = builder.withActions();

  const config = builder;
  const handle = config.buildHandle();
  const editor = handle.lexical;

  // Live caret for Gab typing the first bullet in (document mode only).
  const [gabCaret, setGabCaret] = createSignal<DOMRect | null>(null);
  const gabTyping = () => {
    const rect = gabCaret();
    return rect ? { rect, name: 'Gab', color: 'var(--a2)' } : null;
  };

  // Post-send choreography state (channel mode): sent message, synthetic
  // cursor/click, doc panel, share toast.
  const [sceneSent, setSceneSent] = createSignal(false);
  const [sceneCursor, setSceneCursor] = createSignal(false);
  const [sceneClicked, setSceneClicked] = createSignal(false);
  const [sceneSplit, setSceneSplit] = createSignal(false);
  const [sceneToast, setSceneToast] = createSignal(false);
  const scene: ChannelScene = {
    sent: sceneSent,
    cursorOn: sceneCursor,
    clicked: sceneClicked,
    split: sceneSplit,
    toast: sceneToast,
  };
  const sceneHooks: AutoplayHooks = {
    reset: () => {
      setSceneSent(false);
      setSceneCursor(false);
      setSceneClicked(false);
      setSceneSplit(false);
      setSceneToast(false);
    },
    send: () => setSceneSent(true),
    cursorIn: () => setSceneCursor(true),
    click: () => setSceneClicked(true),
    share: () => {
      setSceneSplit(true);
      setSceneToast(true);
    },
    unshare: () => {
      setSceneSplit(false);
      setSceneToast(false);
      setSceneCursor(false);
      setSceneClicked(false);
    },
  };

  // Belt-and-suspenders attach. MarkdownShell normally wires the root element +
  // initial content via `onElementConnect` (ResizeObserver based). If that
  // hasn't run shortly after mount, attach + seed it manually.
  onMount(() => {
    let tries = 0;
    const ensure = () => {
      if (editor.getRootElement()) return;
      const el = document.querySelector<HTMLElement>('.live-editor-shell [contenteditable]');
      if (el) {
        editor.setRootElement(el);
        setEditorStateFromMarkdown(editor, props.mode.initial);
        return;
      }
      if (tries++ < 40) setTimeout(ensure, 50);
    };
    setTimeout(ensure, 150);

    // The editor's inner scroll container isn't the element floating-ui's
    // autoUpdate attached its scroll listener to, so an open @/​/ menu (and the
    // collab overlay) can drift when the user scrolls inside the editor. Nudge
    // the window-level scroll/resize listeners that autoUpdate + the overlay DO
    // observe, so they reposition against the caret's current rect.
    let pending = false;
    const onInnerScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
      });
    };
    document.addEventListener('scroll', onInnerScroll, { capture: true, passive: true });
    onCleanup(() => document.removeEventListener('scroll', onInnerScroll, true));

    // Autoplay (email / channel): drive the real editor + real mention menu on a
    // loop once it's attached. Starts only after attach so content reconciles.
    const script = props.mode.autoplay;
    if (script) {
      let started = false;
      const startWhenReady = () => {
        if (started || !editor.getRootElement()) {
          if (!started) setTimeout(startWhenReady, 100);
          return;
        }
        started = true;
        const stop = runAutoplay(editor, script, props.layout === 'channel' ? sceneHooks : undefined);
        onCleanup(stop);
      };
      setTimeout(startWhenReady, 450);
    }

    // Document mode: Gab types the first bullet's tail in live once the embed is
    // attached and on-screen (parent posts play/pause as it scrolls into view).
    if (props.layout === 'document') {
      let started = false;
      const startWhenReady = () => {
        if (started || !editor.getRootElement()) {
          if (!started) setTimeout(startWhenReady, 100);
          return;
        }
        started = true;
        const stop = runDocReveal(editor, {
          anchor: DOC_ANCHOR,
          phrase: GAB_PHRASE,
          onCaret: setGabCaret,
        });
        onCleanup(stop);
      };
      setTimeout(startWhenReady, 450);
    }
  });

  const column = (
    <div class={`live-editor-column ${props.mode.columnClass ?? ''}`}>
      <MarkdownShell
        class="live-editor-shell md"
        config={config}
        initialValue={props.mode.initial || undefined}
        placeholder={props.mode.placeholder}
      />
      <Show when={props.mode.collab}>
        <CollabCursors typing={gabTyping} />
      </Show>
    </div>
  );

  if (props.layout === 'email') return <EmailCard>{column}</EmailCard>;
  if (props.layout === 'channel') return <ChannelWindow scene={scene}>{column}</ChannelWindow>;
  return <div class={props.mode.rootClass}>{column}</div>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (root) {
  const layout = resolveMode();
  document.documentElement.classList.add(`mode-${layout}`);
  const mode = MODES[layout];
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <LiveEditor mode={mode} layout={layout} />
      </QueryClientProvider>
    ),
    root,
  );
}
