import { toast } from '@core/component/Toast/Toast';
import type { DocumentMetadataFileType } from '@service-storage/generated/schemas/documentMetadataFileType';
import { createEffect, on, Show } from 'solid-js';

export function VideoContent(props: {
  videoUrl?: string;
  fileType?: DocumentMetadataFileType;
  notifyUnsupported?: boolean;
}) {
  createEffect(
    on(
      () => ({
        fileType: props.fileType,
        notify: props.notifyUnsupported,
        url: props.videoUrl,
      }),
      ({ fileType, notify, url }) => {
        if (!notify || url) return;
        toast.failure('Video playback is not supported for this file type', {
          subtext: `File type: ${fileType}`,
        });
      }
    )
  );

  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 text-ink">
      <Show when={props.videoUrl}>
        {(videoUrl) => (
          <video
            class="size-full"
            controls
            autoplay
            src={videoUrl()}
            onError={(event) => {
              console.error('video error', event);
              toast.failure('Video playback failed');
            }}
          />
        )}
      </Show>
    </div>
  );
}
