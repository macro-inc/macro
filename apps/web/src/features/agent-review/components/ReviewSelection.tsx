import ChatIcon from '@phosphor/chat-circle.svg';
import LinkIcon from '@phosphor/link.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import type { CodeLocation } from '../core/model';

export function ReviewSelection(props: {
  location: CodeLocation;
  disabled?: boolean;
  readOnly?: boolean;
  onComment: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected code"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onDismiss();
        }
      }}
      class="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 rounded-lg border border-edge bg-panel p-1 shadow-md font-sans text-xs"
    >
      <span class="whitespace-nowrap px-2 text-ink-muted tabular-nums">
        L{props.location.line}
        {props.location.endLine &&
        props.location.endLine !== props.location.line
          ? `–${props.location.endLine}`
          : ''}
      </span>
      <Button
        size="xs"
        variant="ghost"
        disabled={props.disabled || props.readOnly}
        onClick={props.onComment}
      >
        <ChatIcon />
        Comment
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        label={
          props.location.endLine &&
          props.location.endLine !== props.location.line
            ? 'Copy link to selected range'
            : 'Copy link to this line'
        }
        disabled={props.disabled}
        onClick={props.onCopy}
      >
        <LinkIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        label="Clear selection"
        onClick={props.onDismiss}
      >
        <XIcon />
      </Button>
    </div>
  );
}
