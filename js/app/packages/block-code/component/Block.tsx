import { useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { Show } from 'solid-js';
import { CodeMarkdown } from './CodeMarkdown';
import { CodeMirror } from './CodeMirror';
import { ModalsMounter } from './ModalsMounter';
import { TopBar } from './TopBar';

export default function BlockCode() {
  const isNestedBlock = useIsNestedBlock();

  return (
    <DocumentBlockContainer usesCenterBar>
      <Show when={!isNestedBlock} fallback={<CodeMarkdown />}>
        <ModalsMounter>
          <div class="size-full bg-panel select-none overscroll-none overflow-hidden flex flex-col items-end relative">
            <TopBar />
            <CodeMirror />
          </div>
        </ModalsMounter>
      </Show>
    </DocumentBlockContainer>
  );
}
