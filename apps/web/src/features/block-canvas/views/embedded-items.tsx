import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { DocumentPreviewSkeleton } from '@core/component/DocumentPreviewSkeleton';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import type { ShapeViewProps } from '@macro-inc/graphics/solid';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { Card } from '@ui';
import {
  type Component,
  createEffect,
  createSignal,
  ErrorBoundary,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasEmbedViewProps } from '../components/embed-view';
import { canEmbedDocument } from '../core/document-display';

export function CanvasMediaView(
  props: ShapeViewProps<'image' | 'video'> & {
    playing: boolean;
    onStop: () => void;
  }
) {
  const source = () => props.item.geometry.source;
  const query = useBinaryDocumentQuery(() => {
    const s = source();
    return s.type === 'document' ? s.id : '';
  });
  const url = () => {
    const value = source();
    if (value.type === 'url') return value.url;
    if (value.type === 'static') return staticFileIdEndpoint(value.id);
    return query.isSuccess ? query.data : undefined;
  };
  const [failed, setFailed] = createSignal(false);
  const [video, setVideo] = createSignal<HTMLVideoElement>();
  createEffect(on(url, () => setFailed(false)));
  createEffect(
    on([video, () => props.playing], ([element, playing]) => {
      if (!element) return;
      if (!playing) {
        element.pause();
        return;
      }
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        element.pause();
      });
      async function play() {
        try {
          await element!.play();
        } catch {
          if (!cancelled) props.onStop();
        }
      }
      void play();
    })
  );
  const unavailable = () => failed() || query.isError;
  return (
    <div
      data-canvas-media={props.item.type}
      class="relative size-full overflow-hidden"
      style={{
        opacity: props.item.appearance.opacity ?? 1,
        'border-radius': `${props.item.appearance.cornerRadius ?? 0}px`,
        border: `${props.item.appearance.strokeWidth ?? 0}px solid ${props.item.appearance.stroke}`,
        'box-sizing': 'border-box',
      }}
    >
      <Suspense
        fallback={
          <div class="grid size-full place-items-center bg-hover text-sm">
            Loading media…
          </div>
        }
      >
        <Show
          when={url() && !unavailable()}
          fallback={
            <div class="grid size-full place-items-center border border-edge-muted bg-panel p-3 text-xs text-ink-muted">
              {unavailable() ? 'Media unavailable' : 'Loading media…'}
            </div>
          }
        >
          <Show
            when={props.item.type === 'image'}
            fallback={
              <video
                ref={setVideo}
                src={url()}
                preload="metadata"
                playsinline
                class="size-full object-fill"
                onError={() => setFailed(true)}
                onEnded={props.onStop}
              />
            }
          >
            <img
              src={url()}
              alt={props.item.geometry.name}
              draggable={false}
              class="size-full object-fill"
              onError={() => setFailed(true)}
            />
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
export function CanvasDocumentView(
  props: ShapeViewProps<'document'> & {
    embedView: Component<CanvasEmbedViewProps>;
    active: boolean;
    onEnter: () => void;
    onExit: () => void;
    onEmbed: () => void;
  }
) {
  const embedded = () =>
    props.item.geometry.display === 'embed' &&
    canEmbedDocument(props.item.geometry.fileType);
  return (
    <Card
      offset={embedded() ? 0 : 1}
      variant="filled"
      data-canvas-document={props.item.geometry.documentId}
      class="size-full overflow-hidden border-edge-muted text-base shadow-lg shadow-drop-shadow"
      data-canvas-embed={embedded() ? props.item.id : undefined}
      data-canvas-embed-active={props.active ? props.item.id : undefined}
      onDblClick={(event) => {
        if (embedded() && !props.active) {
          event.stopPropagation();
          props.onEnter();
        }
      }}
      style={{
        opacity: props.item.appearance.opacity ?? 1,
        'background-color': embedded() ? 'var(--color-panel)' : undefined,
      }}
    >
      <ErrorBoundary
        fallback={
          <div class="p-4 text-sm text-ink-muted">
            Document preview unavailable
          </div>
        }
      >
        <Suspense fallback={<DocumentPreviewSkeleton />}>
          <Show
            when={embedded()}
            fallback={
              <div class="w-full text-base [&_[data-slot=item-title]]:text-base [&_[data-slot=item-description]]:text-base [&_[data-slot=item-metadata]]:text-base">
                <DocumentPreviewContent
                  documentInfo={{
                    id: props.item.geometry.documentId,
                    type: fileTypeToBlockName(props.item.geometry.fileType),
                    params: {},
                    isOpenable: true,
                  }}
                  previewInfo={{
                    showPreview: canEmbedDocument(props.item.geometry.fileType),
                    isPreviewable: true,
                    handlePreviewToggle: props.onEmbed,
                  }}
                />
              </div>
            }
          >
            <div class="flex size-full min-h-0 flex-col">
              <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-3 text-xs">
                <span class="truncate">{props.item.geometry.name}</span>
                <button
                  type="button"
                  class="shrink-0 rounded px-2 py-1 text-accent hover:bg-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.active ? props.onExit() : props.onEnter();
                  }}
                >
                  {props.active ? 'Done' : 'Interact'}
                </button>
              </div>
              <div
                class="min-h-0 flex-1"
                inert={!props.active}
                style={{
                  'pointer-events': props.active ? 'auto' : 'none',
                  'user-select': 'text',
                }}
                on:wheel={(event) => event.stopPropagation()}
              >
                <Dynamic
                  component={props.embedView}
                  geometry={props.item.geometry}
                  active={props.active}
                  onExit={props.onExit}
                />
              </div>
            </div>
          </Show>
        </Suspense>
      </ErrorBoundary>
    </Card>
  );
}
