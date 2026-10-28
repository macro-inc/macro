import { ImageDocumentCard } from '@core/component/ImageDocumentCard';
import { createMemo, type JSX, Show } from 'solid-js';
import { parseLegacyGeneratedImage } from './legacy-generated-image';

/** Persisted results from before GenerateImage switched to static file service. */
export function LegacyGeneratedImage(props: {
  name: string;
  response: unknown;
  children: JSX.Element;
}) {
  const image = createMemo(() =>
    parseLegacyGeneratedImage(props.name, props.response)
  );

  return (
    <Show when={image()} fallback={props.children}>
      {(result) => (
        <div class="my-2 max-w-md space-y-2">
          <ImageDocumentCard
            documentId={result().documentId}
            fileName={result().fileName}
          />
          <Show when={result().note}>
            {(note) => (
              <div class="whitespace-pre-wrap text-sm text-ink-muted">
                {note()}
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
