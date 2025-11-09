import { Keyboard } from '@capacitor/keyboard';
import { useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { onCleanup, onMount, Show } from 'solid-js';
import { CodeMarkdown } from './CodeMarkdown';
import { CodeMirror } from './CodeMirror';
import { TopBar } from './TopBar';

export default function BlockCode() {
  const isNestedBlock = useIsNestedBlock();

  if (isNativeMobilePlatform()) {
    // temporary fix for mobile
    onMount(() => Keyboard.setAccessoryBarVisible({ isVisible: true }));
    onCleanup(() => Keyboard.setAccessoryBarVisible({ isVisible: false }));
  }

  return (
    <DocumentBlockContainer usesCenterBar>
      <Show when={!isNestedBlock} fallback={<CodeMarkdown />}>
        <div class="size-full bg-panel select-none overscroll-none overflow-hidden flex flex-col items-end relative">
          <TopBar />
          <CodeMirror />
        </div>
      </Show>
    </DocumentBlockContainer>
  );
}
