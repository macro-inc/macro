import { useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { Show } from 'solid-js';
import { CodeMarkdown } from './CodeMarkdown';
import { CodeMirror } from './CodeMirror';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockCode() {
  const isNestedBlock = useIsNestedBlock();

  return (
    <DocumentBlockContainer usesCenterBar>
      <Show when={!isNestedBlock} fallback={<CodeMarkdown />}>
        <div class="size-full bg-panel select-none overscroll-none overflow-hidden flex flex-col items-end relative">
          <ModalsProvider>
            <TopBar />
            <CodeMirror />
          </ModalsProvider>
        </div>
      </Show>
    </DocumentBlockContainer>
  );
}
