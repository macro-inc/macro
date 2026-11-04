import ChatTeardrop from '@icon/system/regular/chat-teardrop.svg';
import { Button } from '@ui';

/** Keep the selected editor range alive until the comment command runs. */
export function CommentButton(props: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Comment"
      tooltip="Comment"
      disabled={props.disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick();
      }}
    >
      <ChatTeardrop class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}
