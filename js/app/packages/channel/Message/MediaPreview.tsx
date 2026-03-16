import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { ImagePreview } from '@core/component/ImagePreview';
import { VideoPreview } from '@core/component/VideoPreview';
import { matches } from '@core/util/match';
import { cn } from '@ui/utils/classname';
import { Match, Switch } from 'solid-js';

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

function isSingleImageMediaPreview(
  props: MediaPreviewProps
): props is SingleImageMediaPreviewProps {
  return props.kind === 'single-image';
}

function isImageGalleryMediaPreview(
  props: MediaPreviewProps
): props is ImageGalleryMediaPreviewProps {
  return props.kind === 'image-gallery';
}

function isVideoMediaPreview(
  props: MediaPreviewProps
): props is VideoMediaPreviewProps {
  return props.kind === 'video';
}

function SingleImagePreview(props: SingleImageMediaPreviewProps) {
  return (
    <div
      class={cn('w-full max-w-[400px] min-w-0', props.class)}
      data-message-media-preview="single-image"
    >
      <ImagePreview image={props.image} variant="dynamic" />
    </div>
  );
}

function ImageGalleryMediaPreview(props: ImageGalleryMediaPreviewProps) {
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

function VideoMediaPreview(props: VideoMediaPreviewProps) {
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

export function MediaPreview(props: MediaPreviewProps) {
  return (
    <Switch>
      <Match when={matches(props, isSingleImageMediaPreview)}>
        {(singleImageProps) => <SingleImagePreview {...singleImageProps()} />}
      </Match>
      <Match when={matches(props, isImageGalleryMediaPreview)}>
        {(imageGalleryProps) => (
          <ImageGalleryMediaPreview {...imageGalleryProps()} />
        )}
      </Match>
      <Match when={matches(props, isVideoMediaPreview)}>
        {(videoProps) => <VideoMediaPreview {...videoProps()} />}
      </Match>
    </Switch>
  );
}
