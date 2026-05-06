import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { EmojiSelector } from '@core/component/Emoji/EmojiSelector';
import ReplyIcon from '@icon/regular/arrow-bend-up-left.svg';
import CheckSquareIcon from '@icon/regular/check-square.svg';
import CopyIcon from '@icon/regular/copy.svg';
import LinkIcon from '@icon/regular/link.svg';
import PencilIcon from '@icon/regular/pencil.svg';
import SmileyIcon from '@icon/regular/smiley.svg';
import TrashIcon from '@icon/regular/trash.svg';
import { focusInput } from '@core/directive/focusInput';
import {
  createSignal,
  For,
  onMount,
  Show,
  type Component,
  type JSX,
} from 'solid-js';
import { useMessageActionDrawer } from './message-action-drawer-context';
import { renderIcon } from '../Message/render-icon';
import type {
  MessageActionEvent,
  MessageActionHandler,
  MessageActions,
} from '../Message/types';

const QUICK_REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '😡'] as const;

type ActionId =
  | 'reply'
  | 'copy-link'
  | 'copy-message-text'
  | 'edit'
  | 'delete'
  | 'create-task';

type ActionItem = {
  id: ActionId;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string;
  onClick?: MessageActionHandler;
  destructive?: boolean;
  getFocusTarget?: () => HTMLElement | null | undefined;
};

function buildActionItems(
  actions: MessageActions | undefined,
  messageId: string | undefined
): ActionItem[] {
  return [
    {
      id: 'reply',
      label: 'Reply',
      icon: ReplyIcon,
      onClick: actions?.onReply,
      getFocusTarget: messageId
        ? () =>
            document.querySelector<HTMLElement>(
              `[data-input-id="thread-reply-input-${messageId}"] [contenteditable]`
            )
        : undefined,
    },
    {
      id: 'copy-message-text',
      label: 'Copy message text',
      icon: CopyIcon,
      onClick: actions?.onCopyMessageText,
    },
    {
      id: 'copy-link',
      label: 'Copy link',
      icon: LinkIcon,
      onClick: actions?.onCopyLink,
    },
    {
      id: 'create-task',
      label: 'Create task',
      icon: CheckSquareIcon,
      onClick: actions?.onCreateTask,
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: PencilIcon,
      onClick: actions?.onEdit,
      getFocusTarget: messageId
        ? () =>
            document.querySelector<HTMLElement>(
              `[data-input-id="edit-message-input-${messageId}"] [contenteditable]`
            )
        : undefined,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      onClick: actions?.onDelete,
      destructive: true,
    },
  ];
}

function EmojiSearchView(props: {
  onSelect: (emoji: string) => void;
  onBack: () => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal('');

  onMount(() => {
    setTimeout(() => {
      inputRef?.focus();
    }, 0);
  });

  return (
    <div class="flex flex-col flex-1 min-h-0 pb-2">
      {/* Search input */}
      <div class="flex items-center gap-2 px-3 pb-2 shrink-0">
        <div class="flex flex-1 items-center bg-input border border-edge-muted rounded-sm px-2 py-1.5 text-sm gap-1">
          <input
            ref={inputRef}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search emojis"
            aria-label="Search emojis"
            class="flex-1 bg-transparent outline-none placeholder:text-ink-placeholder"
          />
        </div>
      </div>

      {/* Emoji grid — onPointerDown preventDefault prevents the input from
          blurring before the click fires on an emoji button */}
      <div
        class="overflow-y-auto flex-1 px-1"
        onPointerDown={(e) => e.preventDefault()}
      >
        <EmojiSelector
          nameFilter={query()}
          onEmojiClick={(emoji) => props.onSelect(emoji.emoji)}
          columns={7}
        />
      </div>
    </div>
  );
}

export function ActionDrawer() {
  const drawerState = useMessageActionDrawer();
  const [showEmojiSearch, setShowEmojiSearch] = createSignal(false);

  if (!drawerState) {
    console.warn('No drawer state.');
    return null;
  }

  const message = () => drawerState.message();
  const actions = () => drawerState.actions();

  const handleReaction = (emoji: string, event?: MessageActionEvent) => {
    const msg = message();
    if (!msg) return;
    void actions()?.onReact?.({ message: msg, event, emoji });
    drawerState.close();
    setShowEmojiSearch(false);
  };

  const handleAction = (
    handler: MessageActionHandler | undefined,
    event: MouseEvent
  ) => {
    const msg = message();
    if (!msg) return;
    void handler?.({ message: msg, event });
    drawerState.close();
  };

  const actionItems = () => buildActionItems(actions(), message()?.id);
  const nonDestructiveActions = () =>
    actionItems().filter((item) => item.onClick && !item.destructive);
  const destructiveActions = () =>
    actionItems().filter((item) => item.onClick && item.destructive);
  const hasReactAction = () => actions()?.onReact !== undefined;

  return (
    <MobileDrawer
      side="bottom"
      open={drawerState.isOpen()}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={(v) => {
        if (!v) {
          drawerState.close();
          setShowEmojiSearch(false);
        }
      }}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label="Message actions"
          class={showEmojiSearch() ? 'h-[80vh]' : undefined}
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-3 pb-2 shrink-0">
            <div class="w-10 h-1 rounded-full bg-edge-muted" />
          </div>

          <Show
            when={!showEmojiSearch()}
            fallback={
              <EmojiSearchView
                onSelect={(emoji) => handleReaction(emoji)}
                onBack={() => setShowEmojiSearch(false)}
              />
            }
          >
            {/* Emoji reaction row */}
            <Show when={hasReactAction()}>
              <div class="flex flex-row items-center justify-between px-3 pb-4 gap-1 shrink-0">
                <For each={QUICK_REACTION_EMOJIS}>
                  {(emoji) => (
                    <button
                      type="button"
                      title={`React ${emoji}`}
                      aria-label={`React ${emoji}`}
                      class="size-12 flex items-center justify-center bg-edge rounded-full text-[28px]"
                      onClick={(event) => handleReaction(emoji, event)}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  title="More reactions"
                  aria-label="More reactions"
                  class="size-12 bg-edge rounded-full flex items-center justify-center text-ink-muted"
                  onClick={() => setShowEmojiSearch(true)}
                >
                  {renderIcon(SmileyIcon, 'size-[28px]')}
                </button>
              </div>
            </Show>

            {/* Non-destructive actions */}
            <Show when={nonDestructiveActions().length > 0}>
              <MobileDrawer.Section class="flex flex-col shrink-0">
                <For each={nonDestructiveActions()}>
                  {(action) => (
                    <button
                      type="button"
                      data-message-action={action.id}
                      class="flex items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-hover hover-transition-bg text-left not-last:mb-px bg-panel"
                      ref={(el) => {
                        const getTarget = action.getFocusTarget;
                        if (getTarget) focusInput(el, () => ({ getTarget }));
                      }}
                      onClick={(event) => handleAction(action.onClick, event)}
                    >
                      <span class="size-5 flex items-center justify-center shrink-0">
                        {renderIcon(action.icon)}
                      </span>
                      {action.label}
                    </button>
                  )}
                </For>
              </MobileDrawer.Section>
            </Show>

            {/* Destructive actions */}
            <Show when={destructiveActions().length > 0}>
              <MobileDrawer.Section class="flex flex-col shrink-0 mt-3">
                <For each={destructiveActions()}>
                  {(action) => (
                    <button
                      type="button"
                      data-message-action={action.id}
                      class="flex items-center gap-3 px-4 py-3 text-sm text-failure-ink hover:bg-hover hover-transition-bg text-left not-last:mb-px bg-panel"
                      ref={(el) => {
                        const getTarget = action.getFocusTarget;
                        if (getTarget) focusInput(el, () => ({ getTarget }));
                      }}
                      onClick={(event) => handleAction(action.onClick, event)}
                    >
                      <span class="size-5 flex items-center justify-center shrink-0">
                        {renderIcon(action.icon)}
                      </span>
                      {action.label}
                    </button>
                  )}
                </For>
              </MobileDrawer.Section>
            </Show>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
