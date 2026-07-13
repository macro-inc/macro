import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockMetadataSignal } from '@core/signal/load';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { isHtmlFileType } from '../util/fileMode';
import { CodeMarkdown } from './CodeMarkdown';
import { CodeMirror } from './CodeMirror';
import { HtmlPreview } from './HtmlPreview';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export type CodeBlockMode = 'code' | 'render';

export default function BlockCode() {
  useBlockEntityCommands();
  const isNestedBlock = useIsNestedBlock();
  const blockMetadata = blockMetadataSignal.get;
  const isHtmlFile = createMemo(() =>
    isHtmlFileType(blockMetadata()?.fileType)
  );
  const [mode, setMode] = createSignal<CodeBlockMode>('code');

  createEffect(
    on(isHtmlFile, (htmlFile) => {
      setMode(htmlFile ? 'render' : 'code');
    })
  );

  createEffect(() => {
    console.log('MDOE', mode());
  });

  return (
    <DocumentBlockContainer usesCenterBar>
      <Show when={!isNestedBlock} fallback={<CodeMarkdown />}>
        <div class="size-full bg-surface select-none overscroll-none overflow-hidden flex flex-col items-end relative">
          <ModalsProvider>
            <SidePanel.Layout defaultOpen={false}>
              <FileSidePanelSections />
              <div class="flex size-full min-w-0 flex-col items-end overflow-hidden">
                <TopBar
                  isHtmlFile={isHtmlFile()}
                  mode={mode()}
                  onModeChange={setMode}
                />
                <Show when={mode() === 'render'} fallback={<CodeMirror />}>
                  <Suspense>
                    <HtmlPreview />
                  </Suspense>
                </Show>
              </div>
            </SidePanel.Layout>
          </ModalsProvider>
        </div>
      </Show>
    </DocumentBlockContainer>
  );
}
