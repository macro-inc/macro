import {
  openChatWithInputReplacingSplit,
  openChatWithMessageReplacingSplit,
} from '@app/features/chat/ChatWithAgentButton';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { AnimatedStarIcon } from '@icon/wide-star';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { useSoupView } from './soup-view-context';

export function SearchAskAiButton() {
  const soupView = useSoupView();
  const splitPanel = useSplitPanel();
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      depth={2}
      tooltip="Ask AI"
      class="shrink-0 gap-1.5 rounded-full border border-edge-muted px-2.5 bg-surface"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => {
        const handle = splitPanel?.handle;
        if (!handle) return;
        const query = soupView.searchText().trim();
        if (query) {
          openChatWithMessageReplacingSplit(query, handle);
        } else {
          openChatWithInputReplacingSplit('', handle);
        }
      }}
    >
      <AnimatedStarIcon triggerAnimation={hovering()} />
      <span class="text-xs font-medium">Ask AI</span>
    </Button>
  );
}
