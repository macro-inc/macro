import {
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import './demo-interaction-boundary.css';

const InteractionScope = createContext(false);
export const DEMO_IDLE_RESET_MS = 30_000;
export const DEMO_INTERACTION_EVENT = 'macro-demo-interaction';
export const DEMO_REPLAY_EVENT = 'macro-demo-replay';

/** The standalone sample workspace is already an intentional app visit. */
export function DemoInteractionScope(props: ParentProps) {
  return (
    <InteractionScope.Provider value={true}>
      {props.children}
    </InteractionScope.Provider>
  );
}

/** Preview gestures belong to the page until the visitor explicitly enters a demo. */
export function DemoInteractionBoundary(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    label?: string;
    render?: () => JSX.Element;
  }
) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'ref',
    'label',
    'render',
  ]);
  const nested = useContext(InteractionScope);
  const [active, setActive] = createSignal(false);
  const [interacted, setInteracted] = createSignal(false);
  const [generation, setGeneration] = createSignal(1);
  let root!: HTMLDivElement;
  let content!: HTMLDivElement;
  let entry: HTMLButtonElement | undefined;
  const activate = () => {
    if (active()) return;
    setInteracted(true);
    setActive(true);
    root.dispatchEvent(
      new CustomEvent(DEMO_INTERACTION_EVENT, { bubbles: true })
    );
  };
  const leave = (restoreFocus = false) => {
    setActive(false);
    if (restoreFocus)
      queueMicrotask(() => entry?.focus({ preventScroll: true }));
  };
  onMount(() => {
    if (nested) return;
    const document = root.ownerDocument;
    let visible = true;
    let disposed = false;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const focusedInside = () => {
      const focus = document.activeElement;
      if (!focus || focus === root || focus === entry) return false;
      if (root.contains(focus)) return true;
      const popup = focus.closest(
        '[role="dialog"], [role="menu"], [role="listbox"]'
      );
      return active() && !!popup && !popup.contains(root);
    };
    const refreshReset = () => {
      if (
        disposed ||
        !interacted() ||
        visible ||
        document.hidden ||
        focusedInside()
      ) {
        clearTimeout(resetTimer);
        resetTimer = undefined;
        return;
      }
      // Activity elsewhere on the page must not postpone an abandoned demo.
      if (resetTimer !== undefined) return;
      resetTimer = setTimeout(() => {
        resetTimer = undefined;
        if (disposed || visible || document.hidden || focusedInside()) return;
        setActive(false);
        setInteracted(false);
        // Recreate scene state, timers, and cursors together. Never rewind live edits.
        if (local.render) setGeneration((value) => value + 1);
        else
          for (const frame of root.querySelectorAll<HTMLIFrameElement>(
            'iframe[src]'
          )) {
            if (
              new URL(frame.src, document.baseURI).origin ===
              document.location.origin
            )
              frame.contentWindow?.location.reload();
          }
        root.dispatchEvent(
          new CustomEvent(DEMO_REPLAY_EVENT, { bubbles: true })
        );
      }, DEMO_IDLE_RESET_MS);
    };
    let visibility: IntersectionObserver | undefined;
    const watch = () => {
      if (visibility || (!local.render && !root.querySelector('iframe[src]')))
        return;
      visibility = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        refreshReset();
      });
      visibility.observe(root);
    };
    root.addEventListener(DEMO_INTERACTION_EVENT, watch);
    const activity = () => queueMicrotask(refreshReset);
    document.addEventListener('focusin', activity);
    document.addEventListener('focusout', activity);
    document.addEventListener('pointerdown', activity, true);
    document.addEventListener('visibilitychange', refreshReset);

    const insidePopup = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
    const outside = (event: Event) => {
      if (
        event.type === 'focusin' &&
        (event.target === document.body ||
          event.target === document.documentElement)
      )
        return;
      if (
        !active() ||
        (event.target instanceof Node && root.contains(event.target)) ||
        insidePopup(event.target)
      )
        return;
      leave();
    };
    const escapeFrom = (page: Document, event: KeyboardEvent) => {
      if (!active() || event.key !== 'Escape' || event.defaultPrevented) return;
      // Let native popups use the first Escape; the next exits the demo.
      if (
        page.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')
      )
        return;
      event.preventDefault();
      leave(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Node && root.contains(event.target))
        escapeFrom(document, event);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);

    const frames = new Map<HTMLIFrameElement, () => void>();
    const syncFrames = () => {
      const current = new Set(root.querySelectorAll('iframe'));
      for (const [frame, dispose] of frames)
        if (!current.has(frame)) {
          dispose();
          frames.delete(frame);
        }
      for (const frame of current) {
        if (frames.has(frame)) continue;
        let releasePage: (() => void) | undefined;
        const attach = () => {
          releasePage?.();
          releasePage = undefined;
          let page: Document | null;
          try {
            page = frame.contentDocument;
          } catch {
            return;
          }
          if (!page) return;
          const onKey = (event: KeyboardEvent) => escapeFrom(page, event);
          page.addEventListener('keydown', onKey);
          releasePage = () => page.removeEventListener('keydown', onKey);
        };
        frame.addEventListener('load', attach);
        attach();
        frames.set(frame, () => {
          frame.removeEventListener('load', attach);
          releasePage?.();
        });
      }
    };
    syncFrames();
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('iframe') || node.querySelector('iframe'))
          )
        )
      )
        syncFrames();
    });
    observer.observe(root, { childList: true, subtree: true });
    onCleanup(() => {
      disposed = true;
      observer.disconnect();
      visibility?.disconnect();
      root.removeEventListener(DEMO_INTERACTION_EVENT, watch);
      clearTimeout(resetTimer);
      document.removeEventListener('focusin', activity);
      document.removeEventListener('focusout', activity);
      document.removeEventListener('pointerdown', activity, true);
      document.removeEventListener('visibilitychange', refreshReset);
      for (const dispose of frames.values()) dispose();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', key);
    });
  });

  return (
    <div
      {...rest}
      ref={(element) => {
        root = element;
        if (typeof local.ref === 'function') local.ref(element);
      }}
      class={`demo-interaction-boundary ${local.class ?? ''}`}
      data-demo-active={nested || active()}
      data-demo-interacted={interacted() || undefined}
      tabIndex={-1}
    >
      <div
        ref={content}
        class="demo-interaction-content"
        inert={!nested && !active()}
      >
        <InteractionScope.Provider value={true}>
          <Show when={generation()} keyed>
            {(_generation) => (local.render ? local.render() : local.children)}
          </Show>
        </InteractionScope.Provider>
      </div>
      <Show when={!nested && !active()}>
        <button
          ref={entry}
          class="demo-interaction-activate"
          type="button"
          aria-label={`Interact with ${local.label ?? 'demo'}. Press Escape to return to page scrolling.`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            activate();
            if (event.detail === 0)
              queueMicrotask(() => {
                const first = content.querySelector<HTMLElement>(
                  'iframe, button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"], [contenteditable="true"]'
                );
                (first ?? root).focus({ preventScroll: true });
              });
            else root.focus({ preventScroll: true });
          }}
        />
      </Show>
    </div>
  );
}
