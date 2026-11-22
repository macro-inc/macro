import {
  createMenuOpenSignal,
  MenuPriority,
} from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { setNativeEditMenuSuppressed } from '@core/mobile/nativeEditMenu';
import { debouncedDependent } from '@core/util/debounce';
import { getScrollParentElement } from '@core/util/scrollParent';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BodyPopupSlot } from './body-popup-slots';
import type { BodyFormattingPopupHost, DocumentFormattingHost } from './types';

/** What the touch toolbar needs beyond the shared slots (Source
 *  MarkdownPopup's touch handlers, over the native view). */
export interface NativeBodyTouchActions {
  /** The block id for the touch popup's GeneralizedPopup anchor. */
  readonly documentId: Accessor<string>;
  /** Source ENABLE_MARKDOWN_COMMENTS && canComment. */
  readonly canComment: Accessor<boolean>;
  /** Source handleInsertComment; `hide` on success. */
  insertComment(hide: () => void): void;
  /** Source "Show comment": a range touching a comment thread; `hide`
   *  hides the popup (Source setPopupVisible(false)). */
  readonly openComment: {
    readonly available: Accessor<boolean>;
    open(hide: () => void): void;
  };
  /** Source handleShare: copy the snippet link; `copied` flips the icon. */
  readonly share: Accessor<
    { readonly copied: Accessor<boolean>; copy(): Promise<void> } | undefined
  >;
  /** Source list-to-table on the convertible list at the current generation. */
  readonly table: {
    readonly available: Accessor<boolean>;
    convert(): boolean;
  };
  /** Source handlePaste (iOS native edit menu only); `hide` after the insert. */
  paste(hide: () => void): Promise<void>;
}

/** What the body popup shows and acts on, before any device composition. */
export interface NativeBodyPopupProps {
  host: DocumentFormattingHost;
  popup: BodyFormattingPopupHost;
  commentAction?: {
    readonly canComment: Accessor<boolean>;
    readonly render: (close: () => void) => JSX.Element;
  };
  /** Source selection actions (AI edit, Task) and prompt-owning slots (Link). */
  slots?: readonly BodyPopupSlot[];
  /** The toolbar went away (Source PopupToolbar onCleanup). */
  onToolbarClosed?: () => void;
  /** Source TouchSelectionToolbar's actions, for the touch composition. */
  touch?: NativeBodyTouchActions;
  /** Source Copy link to snippet: last, without a divider, never closing. */
  snippetLinkAction?: {
    readonly available: Accessor<boolean>;
    readonly render: () => JSX.Element;
  };
}

/** The shared popup frame each device composition renders inside. */
export interface NativeBodyPopupFrame {
  readonly props: NativeBodyPopupProps;
  /** The positioned anchor over the selection, once the popup shows. */
  readonly anchor: Accessor<HTMLDivElement | undefined>;
  /** The rendered menu, so focus moving into it keeps the popup open. */
  setMenu(menu: HTMLDivElement): void;
  /** Source's 100 ms debounced visibility. */
  readonly shown: Accessor<boolean>;
  setVisible(visible: boolean): void;
  readonly commentControls: Accessor<boolean>;
  readonly snippetLinkControls: Accessor<boolean>;
}

/** One device's popup: when it has something to show, and how it renders. */
export interface NativeBodyPopupComposition {
  available(frame: NativeBodyPopupFrame): boolean;
  readonly Popup: Component<{ frame: NativeBodyPopupFrame }>;
}

/** Body popup shell: Source MarkdownPopup's visibility, geometry and
 *  listeners. The view entry picks the desktop or touch composition. */
export function NativeBodyFormatPopup(
  props: NativeBodyPopupProps & { composition: NativeBodyPopupComposition }
) {
  const [visible, setVisible] = createMenuOpenSignal(
    'markdown-popup',
    MenuPriority.Normal
  );
  const showPopup = debouncedDependent(visible, 100);
  const [rectangle, setRectangle] = createSignal<DOMRect>();
  const [anchor, setAnchor] = createSignal<HTMLDivElement>();
  const [menu, setMenu] = createSignal<HTMLDivElement>();
  const [scrollY, setScrollY] = createSignal(0);
  const [contentTop, setContentTop] = createSignal(0);
  const [portalRect, setPortalRect] = createSignal<DOMRect>();

  props.popup.registerPopup({
    visible: setVisible,
    selection() {
      setRectangle(props.popup.rectangle());
    },
  });
  props.popup.registerListeners({
    focusOut(target) {
      if (target instanceof Node && menu()?.contains(target)) return;
      setVisible(false);
    },
    transform() {
      setVisible(false);
      return false;
    },
    escape() {
      if (!visible()) return false;
      setVisible(false);
      return true;
    },
  });
  createEffect(() => {
    const root = props.host.root();
    if (!root) return;
    const content = root.closest('[data-block-content]');
    const portal = root.closest<HTMLElement>('.portal-scope');
    const updateGeometry = () => {
      setContentTop(content?.getBoundingClientRect().top ?? 0);
      setPortalRect(portal?.getBoundingClientRect());
      setRectangle(props.popup.rectangle());
    };
    const { observe } = makeResizeObserver(updateGeometry);
    if (content) observe(content);
    if (portal && portal !== content) observe(portal);
    updateGeometry();
    const scroll = getScrollParentElement(root);
    if (scroll) {
      const updateScroll = () => setScrollY(scroll.scrollTop);
      updateScroll();
      scroll.addEventListener('scroll', updateScroll, { passive: true });
      onCleanup(() => scroll.removeEventListener('scroll', updateScroll));
    }
  });
  onCleanup(() => setVisible(false));
  // Source MarkdownPopup: keep the iOS selection menu from stacking on the
  // popup while it shows (a no-op outside the iOS app).
  createEffect(() => setNativeEditMenuSuppressed(visible()));
  onCleanup(() => setNativeEditMenuSuppressed(false));
  const frame: NativeBodyPopupFrame = {
    props,
    anchor,
    setMenu,
    shown: showPopup,
    setVisible,
    commentControls: () =>
      props.host.root() !== null &&
      (props.commentAction?.canComment() ?? false),
    snippetLinkControls: () =>
      props.host.root() !== null &&
      (props.snippetLinkAction?.available() ?? false),
  };
  const position = createMemo(() => {
    const rect = rectangle();
    const scope = portalRect();
    if (!props.composition.available(frame) || !showPopup() || !rect || !scope)
      return undefined;
    return {
      left: rect.left - scope.left,
      top: rect.top - contentTop() + untrack(scrollY),
      width: rect.width,
      height: rect.height,
    };
  });
  return (
    <>
      <Show when={position()}>
        {(point) => (
          <ScopedPortal scope="local">
            <div
              ref={setAnchor}
              class="absolute pointer-events-none"
              style={{
                left: `${point().left}px`,
                top: `${point().top}px`,
                width: `${point().width}px`,
                height: `${point().height}px`,
              }}
            />
          </ScopedPortal>
        )}
      </Show>
      <Dynamic component={props.composition.Popup} frame={frame} />
    </>
  );
}
