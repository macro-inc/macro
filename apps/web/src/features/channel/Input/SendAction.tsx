import { isMobile } from '@core/mobile/isMobile';
import { cn, SendButton } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { useInput, useInputCommands } from './context';
import { hasSendableInputContent } from './utils/sendable-content';

export type SendActionProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Custom tooltip label. Defaults to "Send message". */
  tooltip?: string;
};

export function SendAction(props: SendActionProps) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, [
    'class',
    'disabled',
    'tooltip',
    'hidden',
  ]);
  const hasUploadsInProgress = () =>
    !!input().hasPendingAttachments && !input().sendQueued;
  const isSendQueued = () => !!input().sendQueued;
  const isBlockedByEmptyInput = () => !hasSendableInputContent(input());
  // Allow clicking send while uploads are in progress — it queues the send
  const isDisabled = () => !!local.disabled || isBlockedByEmptyInput();

  const tooltipText = () => {
    if (isSendQueued()) return 'Sending when upload completes…';
    return local.tooltip ?? 'Send message';
  };

  return (
    <SendButton
      appearance="composer"
      tooltip={tooltipText()}
      shortcut="enter"
      aria-label={tooltipText()}
      data-input-action="send"
      pending={hasUploadsInProgress() || isSendQueued()}
      disabled={isDisabled()}
      hidden={isMobile() && isBlockedByEmptyInput()}
      // Full-frame mobile/tablet: pill rounding to match the dock/accessory islands.
      class={cn('touch:rounded-full', local.class)}
      onPointerDown={(event) => {
        event.preventDefault();
        void commands.send();
      }}
      {...rest}
    />
  );
}
