import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { setCopiedItem } from '@core/state/clipboard';
import { onCleanup, onMount, Show } from 'solid-js';
import { ImageHeader } from '../views/image-header';
import { MobileImageHeader } from '../views/mobile/image-header';
import { ImageContent } from './ImageContent';

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
        <SidePanel.Layout defaultOpen={false} floating>
          <FileSidePanelSections />
          <div class="flex size-full min-w-0 flex-col overflow-hidden">
            <Show when={isTouchDevice()} fallback={<ImageHeader />}>
              <MobileImageHeader />
            </Show>
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
      </div>
    </DocumentBlockContainer>
  );
}
