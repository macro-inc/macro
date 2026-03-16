import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { ImagePreview } from '@core/component/ImagePreview';
import { VideoPreview } from '@core/component/VideoPreview';
import { cn } from '@ui/utils/classname';

type ImageAttachment = {
  id: string;
};

type SingleImageMediaPreviewProps = {
  kind: 'single-image';
  image: ImageAttachment;
  class?: string;
};

type ImageGalleryMediaPreviewProps = {
  kind: 'image-gallery';
  images: ImageAttachment[];
  attachmentIds: string[];
  class?: string;
};

type VideoMediaPreviewProps = {
  kind: 'video';
  id: string;
  class?: string;
};

export type MediaPreviewProps =
  | SingleImageMediaPreviewProps
  | ImageGalleryMediaPreviewProps
  | VideoMediaPreviewProps;

export function MediaPreview(props: MediaPreviewProps) {
  if (props.kind === 'single-image') {
    return (
      <div
        class={cn('w-full max-w-[400px] min-w-0', props.class)}
        data-message-media-preview="single-image"
      >
        <ImagePreview image={props.image} variant="dynamic" />
      </div>
    );
  }

  if (props.kind === 'image-gallery') {
    return (
      <div
        class={cn('w-full max-w-[412px] min-w-0', props.class)}
        data-message-media-preview="image-gallery"
      >
        <ImageGalleryPreview
          images={props.images}
          attachmentIds={props.attachmentIds}
          variant="dynamic"
          wrapperClass="flex flex-row flex-wrap gap-2"
        />
      </div>
    );
  }

  return (
    <div
      class={cn(
        'w-full max-w-[400px] min-w-0 [&>div]:max-w-full [&_video]:block [&_video]:max-w-full [&_video]:max-h-[500px]',
        props.class
      )}
      data-message-media-preview="video"
    >
      <VideoPreview id={props.id} variant="dynamic" />
    </div>
  );
}
