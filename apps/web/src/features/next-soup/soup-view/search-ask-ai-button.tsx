import {
  openChatWithInputReplacingSplit,
  openChatWithMessageReplacingSplit,
} from '@app/features/chat/ChatWithAgentButton';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { Button, Hotkey } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import { useSoupView } from './soup-view-context';

export function SearchAskAiButton() {
  const soupView = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [isAsking, setIsAsking] = createSignal(false);
  const askAi = async () => {
    if (isAsking()) return;
    setIsAsking(true);
    try {
      const query = soupView.searchText().trim();
      if (query) {
        await openChatWithMessageReplacingSplit(query, panel.handle);
      } else {
        await openChatWithInputReplacingSplit('', panel.handle);
      }
    } finally {
      setIsAsking(false);
    }
  };

  const askAiHotkey = registerHotkey({
    hotkey: 'tab',
    hotkeyToken: TOKENS.soup.askAi,
    scopeId: panel.splitHotkeyScope,
    description: 'Ask AI',
    keyDownHandler: () => {
      askAi();
      return true;
    },
    runWithInputFocused: true,
  });
  onCleanup(askAiHotkey.dispose);

  return (
    <Button
      variant="ghost"
      size="sm"
      depth={2}
      tooltip="Ask AI"
      class="shrink-0 h-7 mobile:h-9 gap-1.5 rounded-lg px-2"
      disabled={isAsking()}
      onClick={askAi}
    >
      <span class="font-medium">Ask AI</span>
      <Hotkey shortcut={askAiHotkey.hotkey()} theme="subtle" />
    </Button>
  );
}
