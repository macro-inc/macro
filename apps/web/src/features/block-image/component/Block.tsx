import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { setCopiedItem } from '@core/state/clipboard';
import { onCleanup, onMount, Show } from 'solid-js';
import { ImageContent } from './ImageContent';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockImage() {
  useBlockEntityCommands();
  const documentId = useBlockId();

  onMount(() => {
    const copyBlockHandler = (e: KeyboardEvent) => {
      if (e.key === 'c' && e.metaKey) {
        setCopiedItem({
          type: 'document',
          id: documentId,
        });
      }
    };
    window.addEventListener('keydown', copyBlockHandler);
    onCleanup(() => {
      window.removeEventListener('keydown', copyBlockHandler);
    });
  });

  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col">
        <ModalsProvider>
          <SidePanel.Layout defaultOpen={false}>
            <FileSidePanelSections />
            <div class="flex size-full min-w-0 flex-col overflow-hidden">
              <TopBar />
              <Show
                when={blockFileSignal()}
                fallback={
                  <div class="flex size-full items-center justify-center">
                    {/* Loading state handled by DocumentBlockContainer */}
                  </div>
                }
              >
                {(file) => (
                  <ImageContent
                    file={file()}
                    alt={blockMetadataSignal()?.documentName || 'Image'}
                  />
                )}
              </Show>
            </div>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
