import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import ChatIcon from '@phosphor/chat-circle.svg';

false && floatWithElement;

export function ReviewSelection(props: {
  anchor: HTMLElement;
  disabled?: boolean;
  onComment: () => void;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      class="absolute top-0 left-0 z-anchored-controls flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-lg hover:overlay-hover disabled:opacity-50"
      use:floatWithElement={{
        element: () => props.anchor,
        floatingOptions: { placement: 'top-start' },
      }}
      onPointerDown={(event) => event.preventDefault()}
      disabled={props.disabled}
      onClick={props.onComment}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onDismiss();
        }
      }}
    >
      <ChatIcon class="size-3.5 shrink-0" />
      Ask agent
    </button>
  );
}
