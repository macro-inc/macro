import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { setCopiedItem } from '@core/state/clipboard';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { TopBar } from './TopBar';

const { track, TrackingEvents } = withAnalytics();

export default function BlockImage() {
  const documentId = useBlockId();

  const [imageUrl, setImageUrl] = createSignal<string>();

  onMount(() => {
    track(TrackingEvents.BLOCKIMAGE.OPEN);
  });

  const [fileArrayBuffer, setFileArrayBuffer] = createSignal<ArrayBuffer>();
  createEffect(() => {
    const file = blockFileSignal();
    if (!file) return;

    file.arrayBuffer().then(setFileArrayBuffer);
  });

  createEffect(() => {
    try {
      const ext = blockMetadataSignal()?.fileType;
      if (ext == null) return;
      const mime = blockAcceptedFileExtensionToMimeType[ext];

      const arrayBuffer = fileArrayBuffer();
      if (!arrayBuffer) return;
      const blob = new Blob([arrayBuffer], { type: mime });
      const url = URL.createObjectURL(blob);
      setImageUrl(url);

      onCleanup(() => {
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      console.error('Error converting array buffer:', error);
    }
  });

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
      <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col">
        <TopBar />
        <Show
          when={imageUrl()}
          fallback={
            <div class="w-full h-full flex items-center justify-center">
              {/* Loading state handled by DocumentBlockContainer */}
            </div>
          }
        >
          <div class="w-full h-full flex items-center justify-center">
            <img
              src={imageUrl()}
              alt={blockMetadataSignal()?.documentName || 'Image'}
              class="max-w-full max-h-full object-contain"
            />
          </div>
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
