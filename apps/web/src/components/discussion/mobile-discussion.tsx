import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import type { InputHandle, InputSnapshot } from '@channel/Input/types';
import {
  type DrawerSnapPoint,
  MobileDrawer,
} from '@components/app/mobile/MobileDrawer';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { triggerFocusInput } from '@core/directive/focusInput';
import {
  type ConversationPresentation,
  EntityConversationComposer,
} from '@core/messages/EntityConversation';
import { scrollToRenderedTarget } from '@core/messages/scroll-to-rendered-target';
import {
  virtualKeyboardHeight,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import ChatCircleIcon from '@icon/system/regular/chat-circle.svg';
import type { MessageParent } from '@service-storage/messages';
import { Button, EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { DiscussionEntry } from './discussion-entry';
import { discussionPreview } from './discussion-preview';

/** One phone entry and sheet over the caller's existing conversation source. */
export function MobileDiscussion(props: {
  conversation: ConversationPresentation;
  parent: MessageParent;
  canWrite: boolean;
}) {
  const [state, setState] = createStore<{
    open: boolean;
    focusComposer: boolean;
    snapPoint: DrawerSnapPoint;
  }>({
    open: false,
    focusComposer: false,
    snapPoint: 0,
  });
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [thread, setThread] = createSignal<HTMLDivElement>();
  const [footer, setFooter] = createSignal<HTMLDivElement>();
  let input: InputHandle | undefined;
  let draft: InputSnapshot | undefined;
  const preview = createMemo(() =>
    discussionPreview(props.conversation.messages())
  );
  const scrollToEnd = () => {
    const element = thread();
    if (element && !props.conversation.targetId())
      element.scrollTop = element.scrollHeight;
  };
  // Resizing also happens while paging. Only open, send, and keyboard changes
  // choose the newest position; do not override the reader on a body resize.
  createEffect(
    on(
      [
        thread,
        () => props.conversation.targetId(),
        () => props.conversation.targetRequestKey(),
      ],
      ([element, id]) => {
        if (element && id) onCleanup(scrollToRenderedTarget(element, id));
      }
    )
  );
  const open = () => {
    const interaction = beginInteraction('discussion.open');
    try {
      const focusComposer = props.canWrite && !preview().hasComments;
      if (focusComposer)
        triggerFocusInput(() =>
          footer()?.querySelector<HTMLElement>('[contenteditable="true"]')
        );
      setState({ open: true, focusComposer });
    } finally {
      interaction.end();
    }
  };
  createEffect(
    on(
      () =>
        [
          props.conversation.targetId(),
          props.conversation.targetRequestKey(),
        ] as const,
      ([id]) => {
        if (id) setState({ open: true, focusComposer: false });
      }
    )
  );
  // The keyboard consumes only the sheet's bottom content. Keep the newest
  // comment visible after that external viewport change, unless following a link.
  createEffect(
    on(
      [virtualKeyboardHeight, virtualKeyboardVisible],
      () => {
        // A full sheet leaves room for both the thread and the pinned input.
        // Keep it full after typing; dragging can return it to half height.
        if (state.open && virtualKeyboardVisible()) setState('snapPoint', 1);
        scrollToEnd();
      },
      { defer: true }
    )
  );
  // Safari changes the visual viewport while its keyboard animates without
  // publishing a native keyboard-height signal. Content resizes are unrelated.
  const visualViewport = window.visualViewport;
  const followKeyboardResize = () => {
    if (virtualKeyboardVisible()) scrollToEnd();
  };
  visualViewport?.addEventListener('resize', followKeyboardResize);
  onCleanup(() =>
    visualViewport?.removeEventListener('resize', followKeyboardResize)
  );
  return (
    <>
      <div>
        <Show
          when={!props.conversation.pending()}
          fallback={
            <p role="status" class="text-sm text-ink-muted">
              {t('common.loadingConversation')}
            </p>
          }
        >
          <Show
            when={
              !props.conversation.unavailable() &&
              (!props.conversation.failed() || preview().hasComments)
            }
            fallback={
              <Show when={!props.conversation.unavailable()}>
                <Button variant="ghost" onClick={props.conversation.retry}>
                  {t('common.retry')}
                </Button>
              </Show>
            }
          >
            <StaticMarkdownContext>
              <DiscussionEntry
                preview={preview()}
                onOpen={open}
                triggerRef={setTrigger}
              />
            </StaticMarkdownContext>
          </Show>
        </Show>
      </div>
      <MobileDrawer
        open={state.open}
        snapPoints={virtualKeyboardVisible() ? [0, 1] : [0, 0.5, 1]}
        defaultSnapPoint={virtualKeyboardVisible() ? 1 : 0.5}
        activeSnapPoint={state.snapPoint}
        onActiveSnapPointChange={(point) => {
          setState('snapPoint', point);
        }}
        allowSkippingSnapPoints={false}
        onOpenChange={(open) => {
          if (!open) draft = input?.snapshot() ?? draft;
          setState('open', open);
        }}
        restoreFocus
        finalFocusEl={trigger()}
        onInitialFocus={(event) => {
          if (!state.focusComposer) return;
          event.preventDefault();
          input?.focus();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.FixedContent targetHeight={100} fitSnapPoint>
            <MobileDrawer.Handle class="touch-none" />
            <MobileDrawer.Title class="shrink-0 touch-none select-none px-5 pb-3 text-lg font-semibold">
              {t('common.discussion')}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody
              onPointerDown={(
                event: PointerEvent & { currentTarget: HTMLDivElement }
              ) => {
                // Corvu also hands off at the bottom; this thread hands off only
                // at its top so paging through messages never resizes the sheet.
                if (event.currentTarget.scrollTop > 0) event.stopPropagation();
              }}
              ref={(element: HTMLDivElement) => {
                setThread(element);
                queueMicrotask(scrollToEnd);
              }}
              class="px-4"
            >
              <Show
                when={
                  !props.conversation.pending() &&
                  !props.conversation.failed() &&
                  !props.conversation.unavailable() &&
                  !props.conversation.targetId() &&
                  !preview().hasComments
                }
              >
                <EmptyStatePanel
                  centered
                  graphic={ChatCircleIcon}
                  graphicClass="size-12"
                  title={t('common.startDiscussion')}
                  topSpacerClass="basis-0 mobile:basis-0 grow"
                  class="min-h-0 shrink-0 flex-1 px-4 @4xl:px-4 pb-4 touch:pt-0"
                />
              </Show>
              {props.conversation.content()}
            </MobileDrawer.ScrollBody>
            <Show when={props.canWrite && !props.conversation.unavailable()}>
              <MobileDrawer.KeyboardFooter
                ref={setFooter}
                class="px-3"
                data-corvu-no-drag
              >
                <StaticMarkdownContext>
                  <EntityConversationComposer
                    parent={props.parent}
                    onReady={(handle) => {
                      input = handle;
                      if (draft) input.restoreSnapshot(draft, { focus: false });
                      if (state.focusComposer) input.focus();
                    }}
                    onChange={(snapshot) => {
                      draft = snapshot;
                    }}
                    onSent={() => {
                      draft = input?.snapshot();
                      scrollToEnd();
                    }}
                  />
                </StaticMarkdownContext>
              </MobileDrawer.KeyboardFooter>
            </Show>
          </MobileDrawer.FixedContent>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </>
  );
}
