import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import {
  useBlockId,
  useBlockNestedContext,
  useIsNestedBlock,
} from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockFileSignal, blockHandleSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { useSearchParams } from '@solidjs/router';
import { Show } from 'solid-js';
import type { CanvasView } from '../context/canvas-document-context';
import { CanvasDocument, type CanvasDocumentMethods } from './CanvasDocument';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export type BlockCanvasProps = {
  view?: CanvasView;
};

export default function BlockCanvas(props: BlockCanvasProps) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const isNested = useIsNestedBlock();
  const nestedContext = useBlockNestedContext<'canvas'>();
  const canEdit = useCanEdit();
  const hotkeyScope = blockHotkeyScopeSignal.get;
  const file = blockFileSignal.get;
  const blockHandle = blockHandleSignal.get;
  const [locationParams] = useSearchParams();

  const registerMethods = (methods: Partial<CanvasDocumentMethods>) => {
    createMethodRegistration(blockHandle, methods);
  };

  return (
    <DocumentBlockContainer>
      <CanvasDocument
        documentId={documentId}
        file={file()}
        canEdit={canEdit()}
        hotkeyScope={hotkeyScope()}
        isNested={isNested}
        portalScope="block"
        view={props.view}
        locationParams={locationParams}
        onLocationChange={
          nestedContext?.parentContext?.canvas?.onLocationChange
        }
        registerMethods={registerMethods}
      >
        {(content) => (
          <div
            class="size-full select-none flex flex-col"
            on:click={(event) => {
              if (isNested) event.stopPropagation();
            }}
          >
            <ModalsProvider>
              <Show when={!isNested} fallback={content}>
                <SidePanel.Layout defaultOpen={false}>
                  <FileSidePanelSections />
                  <div class="flex size-full min-w-0 flex-col overflow-hidden">
                    <TopBar />
                    {content}
                  </div>
                </SidePanel.Layout>
              </Show>
            </ModalsProvider>
          </div>
        )}
      </CanvasDocument>
    </DocumentBlockContainer>
  );
}
