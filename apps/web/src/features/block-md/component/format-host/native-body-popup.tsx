import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import { PopupPositioner } from '@core/component/GeneralizedPopup/PopupPositioner';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { setNativeEditMenuSuppressed } from '@core/mobile/nativeEditMenu';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
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
import { TouchSelectionToolbar } from '../TouchSelectionToolbar';
import type { BodyPopupSlot } from './body-popup-slots';
import { NativeBodyToolbar } from './native-body-toolbar';
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

/** Body popup: on desktop the actual MarkdownPopup FormatTools subtree and
 *  positioning shell; on touch Source's TouchSelectionToolbar. */
export function NativeBodyFormatPopup(props: {
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
  /** Touch devices: Source TouchSelectionToolbar's actions. */
  touch?: NativeBodyTouchActions;
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
  // Source MarkdownPopup: keep the iOS selection menu from stacking on the
  // popup while it shows (a no-op outside the iOS app).
  createEffect(() => setNativeEditMenuSuppressed(visible()));
  onCleanup(() => setNativeEditMenuSuppressed(false));
  const commentControls = () =>
    props.host.root() !== null && props.commentAction?.canComment();
  const snippetLinkControls = () =>
    props.host.root() !== null &&
    (props.snippetLinkAction?.available() ?? false);
  // Source shows its selection actions independently of formatting authority.
  const slotControls = () =>
    props.host.root() !== null &&
    (props.slots ?? []).some((slot) => slot.button && slot.available());
  const controls = () =>
    props.host.interactable() ||
    commentControls() ||
    snippetLinkControls() ||
    slotControls();
  // Source's touch toolbar always carries Copy and Share, so any live root
  // with touch actions shows it.
  const touchControls = () =>
    isTouchDevice() && props.touch !== undefined && props.host.root() !== null;
  const hide = () => setVisible(false);
  const touchSlot = (id: 'ai' | 'task') =>
    (props.slots ?? []).find(
      (slot) => slot.id === id && slot.select && slot.available()
    );
  // Source's Task option only with the slot's exact label
  // (C-TOUCH-TASK-LABEL-01: never a guessed one).
  const taskOption = () => {
    const slot = touchSlot('task');
    const label = slot?.touchLabel?.();
    return label === undefined
      ? undefined
      : { label, converting: slot?.converting?.() ?? false };
  };
  const position = createMemo(() => {
    const rect = rectangle();
    const scope = portalRect();
    if ((!controls() && !touchControls()) || !showPopup() || !rect || !scope)
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
      <Show when={!isTouchDevice() && controls() && showPopup() && anchor()}>
        {(reference) => (
          <ScopedPortal scope="local">
            <PopupPositioner
              anchor={reference()}
              useBlockBoundary
              ref={setMenu}
            >
              <NativeBodyToolbar
                slots={props.slots ?? []}
                interactable={props.host.interactable}
                formatTools={() => (
                  <>
                    <FormatTools
                      withinPopup
                      formattingHost={props.host}
                      showLinkButton={false}
                    />
                    {/* Source MarkdownPopup: FormatTools then a divider before later actions. */}
                    <Show when={commentControls() || snippetLinkControls()}>
                      <Toolbar.Divider />
                    </Show>
                  </>
                )}
                trailing={() => (
                  <>
                    <Show when={commentControls()}>
                      {props.commentAction?.render(() => setVisible(false))}
                    </Show>
                    <Show when={snippetLinkControls()}>
                      {props.snippetLinkAction?.render()}
                    </Show>
                  </>
                )}
                hide={() => setVisible(false)}
                focusEditor={() => props.host.focus()}
                onClosed={props.onToolbarClosed}
              />
            </PopupPositioner>
          </ScopedPortal>
        )}
      </Show>
      {/* Source PopupToolbar touch branch: TouchSelectionToolbar in a
          GeneralizedPopup, in a global portal above the mobile chrome. */}
      <Show when={touchControls() && showPopup() && props.touch}>
        {(touchActions) => (
          <Show when={anchor()}>
            {(reference) => {
              const touch = touchActions();
              // Source PopupToolbar onCleanup, shared by both toolbars.
              onCleanup(() => props.onToolbarClosed?.());
              return (
                <ScopedPortal scope="global">
                  <GeneralizedPopup
                    class="z-action-menu"
                    anchor={{
                      ref: reference(),
                      blockId: touch.documentId(),
                      blockType: 'md',
                    }}
                    useBlockBoundary={true}
                    ref={setMenu}
                  >
                    <TouchSelectionToolbar
                      canEdit={props.host.interactable()}
                      canComment={touch.canComment()}
                      // Source MarkdownPopup :849: text emptiness, not collapse.
                      hasSelection={props.popup.selectionText() !== ''}
                      showCreateTaskOption={taskOption() !== undefined}
                      createTaskLabel={taskOption()?.label ?? ''}
                      isConverting={taskOption()?.converting ?? false}
                      showTableOption={touch.table.available()}
                      showEditWithAiOption={touchSlot('ai') !== undefined}
                      showOpenCommentOption={touch.openComment.available()}
                      locationCopied={touch.share()?.copied() ?? false}
                      setPopupVisible={setVisible}
                      onCreateTask={() => touchSlot('task')?.select?.(hide)}
                      onConvertListToTable={() => {
                        if (touch.table.convert()) hide();
                      }}
                      onOpenComment={() => touch.openComment.open(hide)}
                      onShare={() => {
                        const link = touch.share();
                        if (link)
                          fireAndForget(link.copy(), 'native-snippet-link');
                      }}
                      onInsertComment={() => touch.insertComment(hide)}
                      onPaste={() =>
                        fireAndForget(touch.paste(hide), 'markdown-editor')
                      }
                      onEditWithAi={() => touchSlot('ai')?.select?.(hide)}
                    />
                  </GeneralizedPopup>
                </ScopedPortal>
              );
            }}
          </Show>
        )}
      </Show>
    </>
  );
}
