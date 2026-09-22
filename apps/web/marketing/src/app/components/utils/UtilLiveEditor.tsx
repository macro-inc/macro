import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { isServer } from 'solid-js/web';

const rajdhani = "'rajdhani', 'body'";

/** Cross-fade from the skeleton to the loaded editor. */
const EDITOR_REVEAL_MS = 420;

/**
 * How long the skeleton will wait for the editor to say it is alive before
 * revealing anyway.
 *
 * The iframe's own load event is not the signal: it fires when the bundle has
 * parsed, and the editor mounts its document a moment after that -- which is
 * why syncTheme already re-runs on a timer. What the embed does emit once the
 * document is really in the DOM is macro-doc-title (and macro-doc-anchor), so
 * that is what lifts the skeleton. This timer is only the backstop for a doc
 * with no heading, or an embed that fails to boot at all: better a bare editor
 * than a skeleton that never leaves.
 */
const EDITOR_REVEAL_FALLBACK_MS = 1200;

/**
 * The skeleton's rows: one per line box in the document the embed opens with.
 *
 * Measured inside the frame rather than composed by eye. .live-editor-column
 * is a 720px max-width box padded 24px 28px, and against the top of its
 * content the blocks sit at
 *
 *   h1  0   (28px box, 20px type)
 *   p   44  (two 24px lines, 16px type)
 *   h2  108 (28px box, 18px type)
 *   li  152, 180, 208, 236, 264   (24px lines on a 28px pitch, indented 24px)
 *
 * The column below repeats the 720/24/28, and each bar is centred in its own
 * line box, so the margins fall out rather than being chosen: 6.5 to centre a
 * 15px bar in the 28px heading, 30 to reach the paragraph, and so on. The
 * result is that the bars sit where the text lands, and the cross-fade is a
 * fade rather than a jump.
 *
 * Heights sit just under cap height -- 15 for the 20px heading against Inter's
 * 14.5, 9 for 16px body against 11.6 -- because a bar shorter than the leading
 * around it reads as a line of text, and one at full cap height reads as a
 * block.
 *
 * Widths are ragged on purpose and are the one thing here that is not
 * measured: a skeleton that reproduced the real line lengths would be a worse
 * placeholder, not a better one, because it would promise copy the visitor is
 * about to read anyway.
 */
type EditorSkeletonRow = {
  width: string;
  height: string;
  marginTop: string;
  marginLeft?: string;
};

const EDITOR_SKELETON_ROWS: EditorSkeletonRow[] = [
  { width: '46%', height: '15px', marginTop: '6.5px' },
  { width: '100%', height: '9px', marginTop: '30px' },
  { width: '88%', height: '9px', marginTop: '15px' },
  { width: '30%', height: '13px', marginTop: '31px' },
  { width: '78%', height: '9px', marginTop: '31px', marginLeft: '24px' },
  { width: '66%', height: '9px', marginTop: '19px', marginLeft: '24px' },
  { width: '71%', height: '9px', marginTop: '19px', marginLeft: '24px' },
  { width: '84%', height: '9px', marginTop: '19px', marginLeft: '24px' },
  { width: '55%', height: '9px', marginTop: '19px', marginLeft: '24px' },
];

/**
 * Placeholder shown between the moment the iframe is created and the moment
 * the editor inside it has a document to paint.
 *
 * Transparent: the window chrome behind it already paints the editor's own
 * surface, so drawing one here would double it and would have to be told the
 * colour for every host this component serves.
 *
 * The wave is a staggered opacity pulse rather than a swept gradient. A sweep
 * has to run over the whole column to stay coherent between bars, which lights
 * the gaps as well as the text and reads as a shine across the panel; per-bar
 * opacity on a 70ms stagger only ever moves the ink.
 */
function EditorSkeleton(props: { revealed: boolean }) {
  return (
    <div
      aria-hidden="true"
      class="live-doc-skeleton"
      style={{
        inset: '0',
        opacity: props.revealed ? 0 : 1,
        'pointer-events': 'none',
        position: 'absolute',
        transition: `opacity ${EDITOR_REVEAL_MS}ms ease`,
        'z-index': 1,
      }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes liveDocSkeletonWave {
            0%, 100% { opacity: 0.55; }
            50% { opacity: 1; }
          }
          .live-doc-skeleton-bar { animation: liveDocSkeletonWave 2.1s ease-in-out infinite; }
        }
      `}</style>
      <div
        style={{
          'box-sizing': 'border-box',
          margin: '0 auto',
          'max-width': '720px',
          padding: '24px 28px',
          width: '100%',
        }}
      >
        <For each={EDITOR_SKELETON_ROWS}>
          {(row, index) => (
            <div
              class="live-doc-skeleton-bar"
              style={{
                'animation-delay': `${index() * 70}ms`,
                background: 'color-mix(in srgb, var(--c1) 9%, transparent)',
                'border-radius': '3px',
                height: row.height,
                'margin-left': row.marginLeft ?? '0',
                'margin-top': row.marginTop,
                'max-width': `calc(100% - ${row.marginLeft ?? '0px'})`,
                width: row.width,
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/**
 * Lazily embeds the real Macro markdown editor (built from the app repo into
 * `public/live-editor/`) inside an isolated iframe. The iframe is only created
 * once the host scrolls near the viewport, so the multi-MB editor bundle never
 * loads on first paint. During prerender (and on mobile, when `active` is
 * false) the crawlable static `fallback` is rendered instead.
 */
export function LiveDocEditor(props: {
  active: boolean;
  fallback: () => JSX.Element;
  src?: string;
  /** Surface color for the editor to sit on (CSS color, may use theme vars).
   * Defaults to the hero window chrome background. */
  background?: string;
  /** Embeds that autoplay should only run while on-screen, so off-screen
   * iframes don't steal keyboard focus. Pauses/resumes via postMessage. */
  pauseWhenOffscreen?: boolean;
  /** Fires once, the first time the user types into the (same-origin) editor. */
  onInteract?: () => void;
  /** Fires with the document's first heading whenever it changes, so the host
   * chrome can show the live title instead of a hardcoded one. */
  onTitleChange?: (title: string) => void;
  /** Fires with the end of the intro paragraph's last line, in coordinates
   * local to this component's box, so the host can aim an annotation at it.
   * Null while it cannot be measured. */
  onAnchor?: (pos: { x: number; y: number } | null) => void;
  /** Fires once, when the skeleton hands over to the loaded editor. Hosts that
   * draw their own annotations over the frame use it to hold them back: a
   * callout pointing into a placeholder points at nothing. */
  onReady?: () => void;
}) {
  if (isServer) return <>{props.fallback()}</>;

  const [visible, setVisible] = createSignal(false);
  // The editor has a document up: fade the skeleton out and the frame in.
  const [revealed, setRevealed] = createSignal(false);
  // Kept mounted through the cross-fade, then dropped so a loaded editor is not
  // sitting under a transparent overlay for the life of the page.
  const [skeleton, setSkeleton] = createSignal(false);
  let host: HTMLDivElement | undefined;
  let frameEl: HTMLIFrameElement | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let unmountTimer: ReturnType<typeof setTimeout> | undefined;

  const reveal = () => {
    if (revealed()) return;
    clearTimeout(revealTimer);
    setRevealed(true);
    props.onReady?.();
    unmountTimer = setTimeout(() => setSkeleton(false), EDITOR_REVEAL_MS + 60);
  };
  onCleanup(() => {
    clearTimeout(revealTimer);
    clearTimeout(unmountTimer);
  });

  // Tell the embed to play/pause its autoplay based on whether it's on-screen.
  const postAutoplay = (action: 'play' | 'pause') => {
    frameEl?.contentWindow?.postMessage(
      { type: 'macro-autoplay', action },
      '*'
    );
  };

  /**
   * Nearest scrollable ancestor of the embed, or the window.
   *
   * Not assumed to be the document: this site scrolls an inner container, so
   * `window.scrollBy` is a no-op on it. Resolved per gesture rather than cached
   * because the scroller depends on layout, which changes with the breakpoint.
   */
  const findScroller = (): HTMLElement | null => {
    let node = host?.parentElement ?? null;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  // Messages from the embed. Both payloads are treated as data rather than
  // trusted input: only this frame's own messages are read, and each field is
  // type-checked before use.
  //
  // - macro-doc-title: the document's first heading, so the window chrome can
  //   track what the visitor types instead of showing a frozen string.
  // - macro-doc-anchor: where the intro sentence ends, in this component's own
  //   coordinate space, so the host can aim its annotation at it.
  // - macro-doc-scroll: a wheel delta the editor could not consume. Scroll
  //   chaining does not cross an iframe boundary, so without this the page
  //   stops scrolling whenever the pointer is over an editor that has overflow.
  onMount(() => {
    if (!props.active) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameEl?.contentWindow) return;

      if (event.data?.type === 'macro-doc-title') {
        const title = event.data.title;
        if (typeof title !== 'string') return;
        // Either of the first two messages means the document is mounted and
        // painting, which is what the skeleton is waiting for. onTitleChange
        // is optional; the reveal is not, so it runs first.
        reveal();
        props.onTitleChange?.(title.slice(0, 120));
        return;
      }

      if (event.data?.type === 'macro-doc-anchor') {
        const { x, y } = event.data;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        reveal();
        props.onAnchor?.({ x, y });
        return;
      }

      if (event.data?.type === 'macro-doc-scroll') {
        const deltaY = event.data.deltaY;
        if (typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return;
        const scroller = findScroller();
        if (scroller) scroller.scrollTop += deltaY;
        else window.scrollBy({ top: deltaY, left: 0, behavior: 'auto' });
      }
    };
    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  onMount(() => {
    if (!props.active || !props.pauseWhenOffscreen) return;
    let playing = true;
    const update = () => {
      if (!host || !frameEl) return;
      const r = host.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const onScreen = r.bottom > 0 && r.top < vh;
      if (onScreen !== playing) {
        playing = onScreen;
        postAutoplay(onScreen ? 'play' : 'pause');
      }
    };
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    onCleanup(() => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    });
  });

  onMount(() => {
    if (!props.active || !host) return;

    let io: IntersectionObserver | undefined;
    const cleanup = () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      io?.disconnect();
    };
    const activate = () => {
      setVisible(true);
      setSkeleton(true);
      cleanup();
    };
    const nearViewport = () => {
      if (!host) return false;
      const r = host.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      return r.top < vh + 300 && r.bottom > -300;
    };
    function onScroll() {
      if (nearViewport()) activate();
    }

    // IntersectionObserver is the primary trigger; a scroll/resize + rect check
    // is a fallback for environments that don't deliver observer callbacks.
    try {
      io = new IntersectionObserver(
        (entries) => entries.some((e) => e.isIntersecting) && activate(),
        { rootMargin: '300px 0px' }
      );
      io.observe(host);
    } catch {
      // no IO — rely on scroll fallback
    }
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    if (nearViewport()) activate();

    onCleanup(cleanup);
  });

  // Copy the live theme tokens from the marketing page into the (same-origin)
  // editor iframe so its palette — including the dynamic accent hue — matches
  // exactly.
  const syncTheme = (frame: HTMLIFrameElement) => {
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      const cs = getComputedStyle(document.documentElement);
      const tokens = [
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
        'b0',
        'b1',
        'b2',
        'b3',
        'b4',
        'c0',
        'c1',
        'c2',
        'c3',
        'c4',
      ];
      for (const t of tokens) {
        const v = cs.getPropertyValue(`--${t}`).trim();
        if (v) doc.documentElement.style.setProperty(`--${t}`, v);
      }
      const chrome = cs.getPropertyValue('--hero-app-chrome-bg').trim();
      if (chrome) {
        doc.documentElement.style.setProperty('--hero-app-chrome-bg', chrome);
      }
      // Match the editor surface to its container (compose card, composer, or
      // doc window). Theme vars resolve inside the iframe after the sync above.
      if (doc.body)
        doc.body.style.background = props.background ?? chrome ?? '';
    } catch {
      // Cross-origin or not ready yet — ignore.
    }
  };

  return (
    <div
      ref={host}
      style={{ height: '100%', position: 'relative', width: '100%' }}
    >
      <Show when={props.active && visible()} fallback={props.fallback()}>
        <iframe
          ref={frameEl}
          src={props.src ?? '/live-editor/index.html'}
          title="Live Macro document editor"
          loading="lazy"
          onLoad={(e) => {
            const frame = e.currentTarget;
            syncTheme(frame);
            // Backstop only -- the embed's own first message normally gets
            // there first. See EDITOR_REVEAL_FALLBACK_MS.
            revealTimer = setTimeout(reveal, EDITOR_REVEAL_FALLBACK_MS);
            // The editor populates a moment after load; re-sync to be safe.
            setTimeout(() => syncTheme(frame), 60);
            // Fire onInteract the first time the user actually types in the
            // (same-origin) editor, so the host can dismiss the "Start typing"
            // hint. Capture phase so the editor can't swallow it first.
            if (props.onInteract) {
              try {
                const doc = frame.contentDocument;
                if (doc) {
                  const onKey = () => {
                    props.onInteract?.();
                    doc.removeEventListener('keydown', onKey, true);
                  };
                  doc.addEventListener('keydown', onKey, true);
                }
              } catch {
                // Cross-origin or not ready — ignore.
              }
            }
            // Seed the autoplay's play/pause to the iframe's current visibility.
            if (props.pauseWhenOffscreen && host) {
              const r = host.getBoundingClientRect();
              const vh =
                window.innerHeight || document.documentElement.clientHeight;
              const onScreen = r.bottom > 0 && r.top < vh;
              setTimeout(
                () =>
                  frame.contentWindow?.postMessage(
                    {
                      type: 'macro-autoplay',
                      action: onScreen ? 'play' : 'pause',
                    },
                    '*'
                  ),
                120
              );
            }
          }}
          style={{
            background: 'transparent',
            border: '0',
            display: 'block',
            height: '100%',
            // Faded in rather than swapped: the frame paints its surface as
            // soon as it exists, so without this the skeleton would be cut off
            // by a flat panel the instant the document arrived.
            opacity: revealed() ? 1 : 0,
            transition: `opacity ${EDITOR_REVEAL_MS}ms ease`,
            width: '100%',
          }}
        />
      </Show>
      <Show when={skeleton()}>
        <EditorSkeleton revealed={revealed()} />
      </Show>
    </div>
  );
}

/**
 * "TRY ME" annotation that sits centered below the text and points up into the
 * editor with a straight arrow. Client-only so it never appears in prerender.
 */
export function TryMePointer(props: {
  active: boolean;
  dismissed?: boolean;
  /** Held at zero opacity until the editor has a document. Defaults to true so
   * a host that draws this over static artwork does not have to opt in. */
  ready?: boolean;
}) {
  if (isServer) return null;
  return (
    <Show when={props.active}>
      <style>{`
        @keyframes liveDocTryMePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.96); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .live-doc-tryme-pulse { animation: liveDocTryMePulse 1.9s ease-in-out infinite; }
        }
      `}</style>
      <div
        aria-hidden="true"
        class="live-doc-tryme"
        style={{
          // Two ways to be invisible, and they are not the same one: not yet
          // (the editor is still a skeleton, so there is nothing to point at)
          // and no longer (the visitor typed). Only the second swells.
          opacity: props.dismissed || props.ready === false ? 0 : 1,
          'pointer-events': 'none',
          // Swell + fade once the user starts typing.
          transform: props.dismissed ? 'scale(1.35)' : 'scale(1)',
          'transform-origin': 'center',
          transition:
            'opacity 450ms ease, transform 450ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* The pulse lives on an inner element, not the wrapper above. A CSS
            animation outranks an inline style, so animating opacity/transform
            on the wrapper would override the dismiss swell and fade and the
            callout would never disappear once the user typed. */}
        <div
          class="live-doc-tryme-pulse"
          style={{
            'align-items': 'center',
            display: 'flex',
            'flex-direction': 'column',
            gap: '4px',
            'transform-origin': 'center',
          }}
        >
          {/* Same arrow glyph as the "Explore X →" buttons, rotated to point up
            into the editor. */}
          <span
            aria-hidden="true"
            style={{
              color: 'var(--a0)',
              display: 'block',
              'font-family': 'body',
              'font-size': '18px',
              'font-weight': '700',
              'line-height': 1,
              transform: 'rotate(-90deg)',
            }}
          >
            →
          </span>
          <span
            style={{
              color: 'var(--a0)',
              'font-family': rajdhani,
              'font-size': '17px',
              'font-weight': '600',
              'letter-spacing': '0.14em',
              'line-height': 1,
              'text-transform': 'uppercase',
              'white-space': 'nowrap',
            }}
          >
            Start typing
          </span>
        </div>
      </div>
    </Show>
  );
}
