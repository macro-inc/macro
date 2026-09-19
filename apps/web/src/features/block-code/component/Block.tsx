import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import {
  blockMetadataSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '@core/signal/load';
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { useSpreadsheetAccess } from '../../block-spreadsheet/primitives/use-spreadsheet-access';
import { saveCodeDocument } from '../queries/code-document';
import { isHtmlFileType } from '../util/fileMode';
import { type CodeBlockMode, CodeContent } from './CodeContent';
import { CodeMarkdown } from './CodeMarkdown';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

const UploadedWorkbook = lazy(
  () => import('../../block-spreadsheet/views/UploadedWorkbook')
);

export default function BlockCode() {
  useBlockEntityCommands();
  const isNestedBlock = useIsNestedBlock();
  const documentId = useBlockId();
  const blockMetadata = blockMetadataSignal.get;
  const blockText = blockTextSignal.get;
  const setBlockText = blockTextSignal.set;
  const blockUserAccess = blockUserAccessSignal.get;
  const spreadsheetEnabled = useSpreadsheetAccess();
  const spreadsheet = () =>
    spreadsheetEnabled() && blockMetadata()?.fileType?.toLowerCase() === 'csv';
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
                <Show
                  when={spreadsheet()}
                  fallback={
                    <CodeContent
                      text={blockText() ?? ''}
                      fileType={blockMetadata()?.fileType}
                      readOnly={readOnly()}
                      mode={mode()}
                      onTextChange={setBlockText}
                      onSave={(text) => saveCodeDocument(documentId, text)}
                    />
                  }
                >
                  <Suspense
                    fallback={
                      <div class="p-6 text-ink-muted">Opening spreadsheet…</div>
                    }
                  >
                    <UploadedWorkbook />
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
