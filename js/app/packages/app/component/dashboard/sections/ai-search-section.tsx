import { ChatWithAgentIcon } from '@app/component/ChatWithAgentButton';
import { useSplitLayout } from '@app/component/split-layout/layout';
import PaperPlaneRightIcon from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

interface AISearchSectionProps {
  class?: string;
}

export function AISearchSection(props: AISearchSectionProps) {
  const { openWithSplit } = useSplitLayout();
  const [query, setQuery] = createSignal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (q) {
      openWithSplit({
        type: 'chat',
        id: 'new',
        params: { initialMessage: q },
      });
      setQuery('');
    } else {
      openWithSplit({ type: 'chat', id: 'new' });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} class={props.class}>
      <div class="flex items-center gap-2 px-3 py-2 bg-ink/5 rounded-lg">
        <div class="size-5 flex items-center justify-center shrink-0 text-chat">
          <ChatWithAgentIcon />
        </div>
        <input
          type="text"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          class="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted outline-none min-w-0"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          class="text-chat"
        >
          <PaperPlaneRightIcon class="size-4" />
        </Button>
      </div>
    </form>
  );
}
