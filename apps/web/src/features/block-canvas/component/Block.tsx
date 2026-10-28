import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import {
  blockDataSignalAs,
  useBlockId,
  useBlockNestedContext,
  useIsNestedBlock,
} from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createMethodRegistration } from '@core/orchestrator';
import { blockFileSignal, blockHandleSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { useSearchParams } from '@solidjs/router';
import { Show } from 'solid-js';
import type { CanvasView } from '../core/view';
import type { CanvasData } from '../definition';
import { CanvasDocument, type CanvasDocumentMethods } from './CanvasDocument';
import { TopBar } from './TopBar';

export type BlockCanvasProps = {
  view?: CanvasView;
};

export default function BlockCanvas(props: BlockCanvasProps) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const data = blockDataSignalAs<CanvasData>('canvas');
  const isNested = useIsNestedBlock();
  const nestedContext = useBlockNestedContext<'canvas'>();
  const canEdit = useCanEdit();
  const file = blockFileSignal.get;
  const blockHandle = blockHandleSignal.get;
  const [locationParams] = useSearchParams();

  const registerMethods = (methods: Partial<CanvasDocumentMethods>) => {
    createMethodRegistration(blockHandle, methods);
  };

  return (
    <DocumentBlockContainer>
      <SidePanel.Root defaultOpen={false} floating>
        <CanvasDocument
          documentId={documentId}
          file={file()}
          shared={data()?.shared}
          canEdit={canEdit()}
          isNested={isNested}
          view={props.view}
          locationParams={locationParams}
          onLocationChange={
            nestedContext?.parentContext?.canvas?.onLocationChange
          }
          registerMethods={registerMethods}
        >
          {(content, state) => {
            return (
              <div
                class="size-full select-none flex flex-col"
                onClick={(event) => {
                  if (isNested) event.stopPropagation();
                }}
              >
                <Show when={!isNested} fallback={content}>
                  <SidePanel.Layout floating>
                    <FileSidePanelSections />
                    <div class="flex size-full min-w-0 flex-col overflow-hidden">
                      <TopBar state={state} />
                      {content}
                    </div>
                  </SidePanel.Layout>
                </Show>
              </div>
            );
          }}
        </CanvasDocument>
      </SidePanel.Root>
    </DocumentBlockContainer>
  );
}
