import { type Camera, type Point, worldToScreen } from '@macro-inc/graphics';
import { For } from 'solid-js';
import type { LocalMediaPreview } from '../core/assets';
import { CanvasMediaContent } from './media-content';

export function MediaUploadPreviews(props: {
  previews: readonly (LocalMediaPreview & { point: Point })[];
  camera: Camera;
}) {
  return (
    <For each={props.previews}>
      {(preview) => {
        const point = () => worldToScreen(props.camera, preview.point);
        const source = preview.media.geometry.source;
        return (
          <div
            data-canvas-upload-preview
            aria-label={`Uploading ${preview.media.geometry.name ?? 'media'}`}
            class="pointer-events-none absolute"
            style={{
              left: `${point().x}px`,
              top: `${point().y}px`,
              width: `${preview.media.geometry.width * props.camera.scale}px`,
              height: `${preview.media.geometry.height * props.camera.scale}px`,
            }}
          >
            <CanvasMediaContent
              url={source.type === 'url' ? source.url : undefined}
              type={preview.media.type}
              name={preview.media.geometry.name}
              playing={false}
              onStop={() => {}}
            />
          </div>
        );
      }}
    </For>
  );
}
