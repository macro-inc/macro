import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import VideoIcon from '@icon/system/regular/file-video.svg';
import LoadingSpinner from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import type { VideoDecoratorProps } from '@macro-inc/lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn } from '@ui';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useVideoHost, type VideoHost } from '../../decorator-host/video-host';
import { resolveStoredMediaUrl } from '../../plugins/media';
import { MediaButtons } from './MediaButtons';
import {
  MediaLoadingPlaceholder,
  mediaFileNameFromUrl,
} from './MediaLoadingPlaceholder';
import { ResizeHandle } from './ResizeHandle';

type VideoState = 'loading' | 'ok' | 'error';

const VideoErrors = {
  UNAUTHORIZED: 'You do not have access to this video.',
  MISSING: 'This video does not exist.',
  GONE: 'This video has been deleted.',
  FALLBACK: 'This video could not be found.',
} as const;
type VideoError = keyof typeof VideoErrors;

function Spinner() {
  return (
    <div class="animate-spin size-5">
      <LoadingSpinner class="size-5" />
    </div>
  );
}

/**
 * Source `MediaNode.updateFromJSON` sets the stored source type, id and
 * dimensions unchanged, so null or omitted values reach this component. Its
 * reads tolerate them: dimensions fall back with `|| 0`, and the source type
 * and id only select a media url branch or interpolate into its request.
 * The url is kept as stored too: a local or public url, null or omitted, goes
 * into the video src signal, where Solid drops a null or undefined src alike,
 * and the file-name helper converts it with String() as the URL constructor
 * does. Static-file and document-service sources always resolve to text.
 */
export type MarkdownVideoProps = Omit<
  VideoDecoratorProps,
  | 'srcType'
  | 'id'
  | 'url'
  | 'width'
  | 'height'
  | 'constrainedWidth'
  | 'constrainedHeight'
> & {
  srcType?: string | null;
  id?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  constrainedWidth?: number | null;
  constrainedHeight?: number | null;
  host?: VideoHost;
};

export function MarkdownVideo(props: MarkdownVideoProps) {
  let videoRef!: HTMLVideoElement;
  let containerRef!: HTMLDivElement;

  const host = useVideoHost(props.host);
  const interactable = host.isInteractable;

  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [videoHover, setVideoHover] = createSignal(false);
  const [uploading, setUploading] = createSignal(props.srcType === 'local');
  const [videoDims, setVideoDims] = createSignal<[number, number]>([
    props.width || 0,
    props.height || 0,
  ]);
  const [videoUrl, setVideoUrl] = createSignal<string | null | undefined>('');
  // Solid removes a null or undefined src alike, as Source's null url does.
  const videoSrc = () => videoUrl() ?? undefined;
  const [state, setState] = createSignal<VideoState>('loading');
  const [videoError, setVideoError] = createSignal<VideoError | undefined>();

  const [scale, setScale] = createSignal(props.scale);

  createEffect(() => {
    if (props.srcType === 'local') {
      setVideoUrl(props.url);
      return;
    }
    if (props.srcType === 'url') {
      setVideoUrl(props.url);
      return;
    }
    // Local and public sources returned above, so the rest resolve to text.
    fireAndForget(
      resolveStoredMediaUrl({
        type: props.srcType,
        id: props.id,
        url: props.url,
      }).then((maybeUrl) => {
        if (maybeUrl.isErr()) {
          setState('error');
          if (
            maybeUrl.isErr() &&
            maybeUrl.error.some((error) => error.code === 'UNAUTHORIZED')
          )
            setVideoError('UNAUTHORIZED');
          else if (maybeUrl.error.some((error) => error.code === 'NOT_FOUND'))
            setVideoError('MISSING');
          else if (
            maybeUrl.isErr() &&
            maybeUrl.error.some((error) => error.code === 'GONE')
          )
            setVideoError('GONE');
          else setVideoError('FALLBACK');
          return;
        }
        const url = maybeUrl.value;
        setVideoUrl(url);
        if (props.srcType === 'dss') host.video.upgradeUrl(props.key, url);
      }),
      'markdown-media'
    );
  });

  const isSelectedAsNode = () => host.isSelected(props.key);
  const clickVideoHandler = () => host.video.select(props.key);
  const deleteVideo = () => host.video.remove(props.key);

  const viewFull = () => {
    if (state() === 'ok') {
      setViewerOpen(true);
    }
  };

  const loadVideo = () => {
    setState('ok');
    setVideoDims([videoRef.videoWidth, videoRef.videoHeight]);
    host.video.resize(props.key, videoRef.videoWidth, videoRef.videoHeight);
  };

  const onVideoError = () => {
    if (videoUrl()) {
      // only set error if we looked for a real url
      setState('error');
    }
  };

  let cleanupListners = () => {};

  onMount(() => {
    videoRef.addEventListener('loadeddata', loadVideo);
    videoRef.addEventListener('error', onVideoError);
    cleanupListners = host.video.subscribeUploads(props.key, {
      start: () => setUploading(true),
      success: () => setUploading(false),
      cancelled: () => setUploading(false),
      failure: () => {
        setUploading(false);
        toast.failure('Failed to upload video');
      },
    });
    host.video.mounted(props.key);
  });

  onCleanup(() => {
    videoRef.removeEventListener('loadeddata', loadVideo);
    videoRef.removeEventListener('error', onVideoError);
    cleanupListners();
  });

  const persistScale = debounce((value: number) => {
    host.video.persistScale(props.key, value);
  }, 60);
  createEffect(on(scale, persistScale));
  createEffect(() => {
    if (!interactable()) {
      persistScale.clear();
      const committedScale = host.video.readScale(props.key, props.scale);
      setScale(committedScale ?? props.scale);
    }
  });

  const debouncedSetHover = debounce((state: boolean) => {
    setVideoHover(state);
  }, 300);

  return (
    <Dialog open={viewerOpen()} onOpenChange={setViewerOpen}>
      <div
        ref={containerRef}
        class={cn(
          'relative max-w-full my-4 grid place-items-center mx-auto',
          isSelectedAsNode() && 'ring-3 ring-edge-muted',
          state() === 'error' &&
            'pattern-edge-muted pattern-diagonal-8 min-h-44'
        )}
        style={{
          'max-height': videoDims()[1]
            ? `${videoDims()[1] * scale()}px`
            : undefined,
          'aspect-ratio':
            videoDims()[0] && videoDims()[1]
              ? `${videoDims()[0] / videoDims()[1]}`
              : 'auto',
        }}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          clickVideoHandler();
        }}
        onDblClick={(e: MouseEvent) => {
          e.preventDefault();
          viewFull();
        }}
        onMouseEnter={() => {
          debouncedSetHover(true);
        }}
        onMouseLeave={() => {
          debouncedSetHover.clear();
          setVideoHover(false);
        }}
      >
        <Show when={state() === 'ok' && interactable()}>
          <ResizeHandle
            scale={scale}
            setScale={(value) => {
              if (interactable() && host.isEditable()) setScale(value);
            }}
            side="left"
            imageDims={videoDims}
            containerRef={containerRef}
          />
          <ResizeHandle
            scale={scale}
            setScale={(value) => {
              if (interactable() && host.isEditable()) setScale(value);
            }}
            side="right"
            imageDims={videoDims}
            containerRef={containerRef}
          />
        </Show>
        <video
          crossorigin="anonymous"
          class={cn(
            'h-full object-contain',
            (state() === 'loading' || state() === 'error') && 'invisible',
            state() === 'loading' &&
              !videoDims()[0] &&
              'absolute inset-0 size-0'
          )}
          draggable={true}
          ref={videoRef}
          src={videoSrc()}
          controls={state() === 'ok'}
          style={{
            width: `${videoDims()[0] ? videoDims()[0] * scale() : 'auto'}px`,
          }}
        />

        <Show when={state() === 'error'}>
          <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted min-h-44">
            <VideoIcon class="size-5" />
            <div>{VideoErrors[videoError() ?? 'FALLBACK']}</div>
          </div>
        </Show>

        <Show when={state() === 'loading'}>
          <Show
            when={videoDims()[0] > 0}
            fallback={
              <MediaLoadingPlaceholder
                kind="video"
                label={mediaFileNameFromUrl(props.url)}
              />
            }
          >
            <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted bg-hover/50">
              <Spinner />
            </div>
          </Show>
        </Show>

        <Show when={uploading() && state() !== 'error'}>
          <div class="absolute flex gap-2 top-2 left-2 justify-center items-center p-2">
            <Spinner />
            Saving Video...
          </div>
        </Show>

        <Show
          when={
            (isSelectedAsNode() || videoHover()) &&
            (state() === 'ok' || state() === 'error')
          }
        >
          <div class="size-full absolute top-0 left-0 pointer-events-none bg-edge/10" />
          <MediaButtons
            delete={interactable() ? deleteVideo : undefined}
            enlarge={state() === 'ok' ? viewFull : undefined}
            newTab={
              state() === 'ok'
                ? () => {
                    // window.open converts a null url to "null" and treats an
                    // omitted one as its default, as Source passes the url.
                    const url = videoUrl();
                    window.open(url === null ? String(url) : url, '_blank');
                  }
                : undefined
            }
            containerRef={containerRef}
          />
        </Show>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay items-center justify-center" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center bg-transparent">
          <Dialog.Content class="relative max-w-[65%] max-h-[80vh] flex items-center justify-center">
            <div class="absolute bg-surface top-2 right-2 flex flex-row z-10">
              <Dialog.CloseButton>
                <Button variant="ghost" size="icon-md">
                  <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
              </Dialog.CloseButton>
            </div>
            <video
              crossorigin="anonymous"
              class="max-w-full max-h-[80vh] size-auto object-contain"
              controls
              src={videoSrc()}
            />
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
