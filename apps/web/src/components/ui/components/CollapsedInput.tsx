import { focusInput } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { type Accessor, type JSX, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { ComposerSurface } from './ComposerSurface';
import { Layer } from './Layer';
import { SendButton } from './SendButton';

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
  /** Extra composer action placed immediately before Send. */
  trailingAction?: JSX.Element;
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
    <Layer depth={3} data-collapsed-input>
      <ComposerSurface
        as="div"
        data-composer-collapsed
        class={cn(
          'w-full h-[48.75px] flex min-w-0 items-center gap-[5.625px] px-[7.5px] touch:rounded-xl touch:h-12.5 touch:island touch:gap-1.5 touch:px-2',
          props.class
        )}
      >
        <Button
          variant="ghost"
          size="icon-composer"
          class="not-touch:light-mode:text-composer-ink"
          aria-label="Attach files"
          label="Attach files"
          onClick={() => props.onAttach?.()}
        >
          <PaperclipIcon />
        </Button>
        <button
          type="button"
          class={cn(
            'min-w-0 flex-1 overflow-hidden rounded-sm px-1.5 text-left text-base outline-none',
            'flex h-8 items-center text-ink focus-visible:bg-active not-touch:h-[30px] not-touch:px-[5.625px] not-touch:leading-[24.375px]'
          )}
          ref={attachFocusInput}
          onClick={() => props.onOpen?.()}
          data-collapsed-input-preview
        >
          <Show
            when={hasText()}
            fallback={
              <span class="truncate text-ink-placeholder not-touch:text-composer-placeholder">
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
        {props.trailingAction}
        <Show when={!isMobile() || !props.disabled}>
          <SendButton
            appearance="composer"
            pending={props.pending}
            disabled={props.disabled || props.pending}
            onPointerDown={(event) => {
              event.preventDefault();
              void props.onSend?.();
            }}
            data-collapsed-input-send
          />
        </Show>
      </ComposerSurface>
    </Layer>
  );
}
