import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import {
  blockMetadataSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '@core/signal/load';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { saveCodeDocument } from '../queries/code-document';
import { isHtmlFileType } from '../util/fileMode';
import { type CodeBlockMode, CodeContent } from './CodeContent';
import { CodeMarkdown } from './CodeMarkdown';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockCode() {
  useBlockEntityCommands();
  const isNestedBlock = useIsNestedBlock();
  const documentId = useBlockId();
  const blockMetadata = blockMetadataSignal.get;
  const blockText = blockTextSignal.get;
  const setBlockText = blockTextSignal.set;
  const blockUserAccess = blockUserAccessSignal.get;
  const isHtmlFile = createMemo(() =>
    isHtmlFileType(blockMetadata()?.fileType)
  );
  const readOnly = createMemo(
    () => blockUserAccess() !== 'owner' && blockUserAccess() !== 'edit'
  );
  const [mode, setMode] = createSignal<CodeBlockMode>('code');

  createEffect(
    on(isHtmlFile, (htmlFile) => {
      setMode(htmlFile ? 'render' : 'code');
    })
  );

  return (
    <DocumentBlockContainer usesCenterBar>
      <Show when={!isNestedBlock} fallback={<CodeMarkdown />}>
        <div class="size-full select-none overscroll-none overflow-hidden flex flex-col items-end relative">
          <ModalsProvider>
            <SidePanel.Layout defaultOpen={false}>
              <FileSidePanelSections />
              <div class="flex size-full min-w-0 flex-col items-end overflow-hidden">
                <TopBar
                  isHtmlFile={isHtmlFile()}
                  mode={mode()}
                  onModeChange={setMode}
                />
                <CodeContent
                  text={blockText() ?? ''}
                  fileType={blockMetadata()?.fileType}
                  readOnly={readOnly()}
                  mode={mode()}
                  onTextChange={setBlockText}
                  onSave={(text) => saveCodeDocument(documentId, text)}
                />
              </div>
            </SidePanel.Layout>
          </ModalsProvider>
        </div>
      </Show>
    </DocumentBlockContainer>
  );
}
