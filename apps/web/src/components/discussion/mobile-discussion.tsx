import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import type { InputHandle, InputSnapshot } from '@channel/Input/types';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { triggerFocusInput } from '@core/directive/focusInput';
import {
  type ConversationPresentation,
  EntityConversationComposer,
} from '@core/messages/EntityConversation';
import { virtualKeyboardHeight } from '@core/mobile/virtualKeyboard';
import type { MessageParent } from '@service-storage/messages';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DiscussionEntry } from './discussion-entry';
import { discussionPreview } from './discussion-preview';

/** One phone entry and sheet over the caller's existing conversation source. */
export function MobileDiscussion(props: {
  conversation: ConversationPresentation;
  parent: MessageParent;
  canWrite: boolean;
  targetId?: string | null;
  targetRequestKey?: string | number;
}) {
  const [state, setState] = createStore({ open: false, focusComposer: false });
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
    if (element && !props.targetId) element.scrollTop = element.scrollHeight;
  };
  createResizeObserver(thread, scrollToEnd);
  const open = () => {
    const interaction = beginInteraction('discussion.open');
    try {
      const focusComposer = props.canWrite && preview().count === 0;
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
      () => [props.targetId, props.targetRequestKey] as const,
      ([id]) => {
        if (id) setState({ open: true, focusComposer: false });
      }
    )
  );
  // The keyboard consumes only the sheet's bottom content. Keep the newest
  // comment visible after that external viewport change, unless following a link.
  createEffect(
    on(
      [virtualKeyboardHeight, () => props.conversation.messages().length],
      scrollToEnd,
      { defer: true }
    )
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
              (!props.conversation.failed() || preview().count > 0)
            }
            fallback={
              <Button variant="ghost" onClick={props.conversation.retry}>
                {t('common.retry')}
              </Button>
            }
          >
            <StaticMarkdownContext>
              <DiscussionEntry
                preview={preview()}
                incomplete={props.conversation.hasEarlier()}
                onOpen={open}
                triggerRef={setTrigger}
              />
            </StaticMarkdownContext>
          </Show>
        </Show>
      </div>
      <MobileDrawer
        open={state.open}
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
          <MobileDrawer.FixedContent targetHeight={100}>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="shrink-0 px-5 pb-3 text-lg font-semibold">
              {t('common.discussion')}{' '}
              <span class="ml-1 font-normal text-ink-muted">
                {preview().count}
                {props.conversation.hasEarlier() ? '+' : ''}
              </span>
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody
              ref={(element: HTMLDivElement) => {
                setThread(element);
                queueMicrotask(scrollToEnd);
              }}
              class="px-4"
            >
              {props.conversation.content()}
            </MobileDrawer.ScrollBody>
            <Show when={props.canWrite && !props.conversation.unavailable()}>
              <MobileDrawer.KeyboardFooter ref={setFooter} class="px-3">
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
                      draft = undefined;
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
