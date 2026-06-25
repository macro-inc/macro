import { focusInput } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { type Accessor, type JSX, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { SendButton } from './SendButton';
import { Surface } from './Surface';

export type CollapsedInputProps = {
  /** Draft of the real input, shown as the one-line preview. */
  draft?: string;
  /**
   * Renders the one-line draft preview. Receives the trimmed draft as an
   * accessor; the draft is rendered as plain text when omitted.
   */
  renderDraft?: (draft: Accessor<string>) => JSX.Element;
  placeholder?: string;
  attachmentCount?: number;
  /** Renders the send button with a spinner and disables it. */
  pending?: boolean;
  /**
   * Disables sending, e.g. when the draft has nothing sendable. The send
   * button is hidden on mobile and rendered disabled on desktop.
   */
  disabled?: boolean;
  class?: string;
  /**
   * Target of the real input this trigger stands in for. Focused via the
   * `focusInput` directive when the trigger is clicked, so the iOS virtual
   * keyboard opens within the user gesture.
   */
  getFocusTarget?: () => HTMLElement | null | undefined;
  onAttach?: () => void;
  onOpen?: () => void;
  onSend?: () => void | Promise<void>;
};

export function CollapsedInput(props: CollapsedInputProps) {
  const attachFocusInput = (el: HTMLElement) => {
    const getTarget = props.getFocusTarget;
    if (getTarget) focusInput(el, () => ({ getTarget }));
  };

  const text = () => props.draft?.trim() ?? '';
  const hasText = () => text().length > 0;
  const attachmentCount = () => props.attachmentCount ?? 0;
  const hasAttachments = () => attachmentCount() > 0;

  return (
    <Surface
      depth={2}
      solid
      // h-12.5 and px-2 keep the attach/send buttons exactly where the
      // expanded input's footer puts them (`p-2 mb-2 h-8` plus the surface's
      // 1px border: button centers 25px above the outer bottom edge, 8px in
      // from the border).
      class={cn('rounded-xl w-full h-12.5', props.class)}
      data-collapsed-input
    >
      <div class="flex h-full min-w-0 items-center gap-1.5 px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Attach files"
          label="Attach files"
          onClick={() => props.onAttach?.()}
        >
          <PaperclipIcon />
        </Button>
        <button
          type="button"
          class={cn(
            'min-w-0 flex-1 overflow-hidden rounded-sm px-1.5 text-left text-sm outline-none',
            'flex h-8 items-center text-ink focus-visible:bg-active'
          )}
          ref={attachFocusInput}
          onClick={() => props.onOpen?.()}
          data-collapsed-input-preview
        >
          <Show
            when={hasText()}
            fallback={
              <span class="truncate text-ink-placeholder">
                {props.placeholder ?? 'Message'}
              </span>
            }
          >
            {/* Interactive content in the rendered draft (mentions, links)
                must not swallow the tap that opens the input. */}
            <div class="pointer-events-none min-w-0 flex-1 truncate">
              {props.renderDraft ? props.renderDraft(text) : text()}
            </div>
          </Show>
        </button>
        <Show when={hasAttachments() && !hasText()}>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 px-1.5 gap-1"
            aria-label={`${attachmentCount()} attachment${
              attachmentCount() === 1 ? '' : 's'
            }`}
            label={`${attachmentCount()} attachment${
              attachmentCount() === 1 ? '' : 's'
            }`}
            ref={attachFocusInput}
            onClick={() => props.onOpen?.()}
            data-collapsed-input-attachments
          >
            <PaperclipIcon />
            <span>{attachmentCount()}</span>
          </Button>
        </Show>
        <Show when={!isMobile() || !props.disabled}>
          <SendButton
            // Match the expanded input's send button (pill on mobile).
            class="mobile:rounded-full"
            pending={props.pending}
            disabled={props.disabled || props.pending}
            onPointerDown={(event) => {
              event.preventDefault();
              void props.onSend?.();
            }}
            data-collapsed-input-send
          />
        </Show>
      </div>
    </Surface>
  );
}
