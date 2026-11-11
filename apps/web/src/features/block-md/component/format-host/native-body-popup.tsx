import { PopupPositioner } from '@core/component/GeneralizedPopup/PopupPositioner';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debouncedDependent } from '@core/util/debounce';
import { getScrollParentElement } from '@core/util/scrollParent';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { Toolbar } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { FormatTools } from '../FormatTools';
import type { BodyFormattingPopupHost, DocumentFormattingHost } from './types';

/** Desktop body popup: the actual MarkdownPopup FormatTools subtree and positioning shell. */
export function NativeBodyFormatPopup(props: {
  host: DocumentFormattingHost;
  popup: BodyFormattingPopupHost;
  commentAction?: {
    readonly canComment: Accessor<boolean>;
    readonly render: (close: () => void) => JSX.Element;
  };
  /** Source Copy link to snippet: last, without a divider, never closing. */
  snippetLinkAction?: {
    readonly available: Accessor<boolean>;
    readonly render: () => JSX.Element;
  };
}) {
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
  const commentControls = () =>
    props.host.root() !== null && props.commentAction?.canComment();
  const snippetLinkControls = () =>
    props.host.root() !== null && (props.snippetLinkAction?.available() ?? false);
  const controls = () =>
    props.host.interactable() || commentControls() || snippetLinkControls();
  const position = createMemo(() => {
    const rect = rectangle();
    const scope = portalRect();
    if (!controls() || !showPopup() || !rect || !scope) return undefined;
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
      <Show when={!isTouchDevice() && controls() && showPopup() && anchor()}>
        {(reference) => (
          <ScopedPortal scope="local">
            <PopupPositioner
              anchor={reference()}
              useBlockBoundary
              ref={setMenu}
            >
              <Toolbar aria-label="Document selection">
                <Show when={props.host.interactable()}>
                  <FormatTools
                    withinPopup
                    formattingHost={props.host}
                    showLinkButton={false}
                  />
                  {/* Source MarkdownPopup: FormatTools then a divider before later actions. */}
                  <Show when={commentControls() || snippetLinkControls()}>
                    <Toolbar.Divider />
                  </Show>
                </Show>
                <Show when={commentControls()}>
                  {props.commentAction?.render(() => setVisible(false))}
                </Show>
                <Show when={snippetLinkControls()}>
                  {props.snippetLinkAction?.render()}
                </Show>
              </Toolbar>
            </PopupPositioner>
          </ScopedPortal>
        )}
      </Show>
    </>
  );
}
