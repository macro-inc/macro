import { AiChatEmptyState } from '../AIChatEmptyState';

export function EmptyChatState(props: { minHeight: number }) {
  return (
    <div
      class="flex w-full items-center justify-center py-6"
      style={{
        'min-height': `${props.minHeight}px`,
      }}
    >
      <AiChatEmptyState />
    </div>
  );
}
