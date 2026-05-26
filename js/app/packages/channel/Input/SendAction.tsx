import { isMobile } from '@core/mobile/isMobile';
import { SendButton } from '@ui';
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
  const [local, rest] = splitProps(props, ['class', 'tooltip', 'hidden']);
  const isBlockedByPending = () => !!input().hasPendingAttachments;
  const isBlockedByEmptyInput = () => !hasSendableInputContent(input());

  const tooltipText = () => local.tooltip ?? 'Send message';

  return (
    <SendButton
      tooltip={tooltipText()}
      shortcut="enter"
      aria-label={tooltipText()}
      data-input-action="send"
      pending={isBlockedByPending()}
      disabled={isBlockedByPending() || isBlockedByEmptyInput()}
      hidden={isMobile() && isBlockedByEmptyInput()}
      class={local.class}
      onPointerDown={(event) => {
        event.preventDefault();
        void commands.send();
      }}
      {...rest}
    />
  );
}
