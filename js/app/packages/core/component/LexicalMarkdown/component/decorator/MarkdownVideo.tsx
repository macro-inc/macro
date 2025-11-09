import { IconButton } from '@core/component/IconButton';
import { toast } from '@core/component/Toast/Toast';
import { debouncedDependent } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import VideoIcon from '@icon/regular/file-video.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { mergeRegister } from '@lexical/utils';
import { $isVideoNode, type VideoDecoratorProps } from '@lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import {
  $upgradeDSSMediaUrl,
  getMediaUrl,
  ON_MEDIA_COMPONENT_MOUNT_COMMAND,
  UPDATE_MEDIA_SIZE_COMMAND,
  UPLOAD_MEDIA_FAILURE_COMMAND,
  UPLOAD_MEDIA_START_COMMAND,
  UPLOAD_MEDIA_SUCCESS_COMMAND,
} from '../../plugins';
import { MediaButtons } from './MediaButtons';
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

export function MarkdownVideo(props: VideoDecoratorProps) {
  let videoRef!: HTMLVideoElement;
  let containerRef!: HTMLDivElement;

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;
  const editor = () => lexicalWrapper?.editor;
  const interactable = () => lexicalWrapper?.isInteractable() ?? false;

  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [videoHover, setVideoHover] = createSignal(false);
  const [uploading, setUploading] = createSignal(props.srcType === 'local');
  const [videoDims, setVideoDims] = createSignal<[number, number]>([
    props.width || 0,
    props.height || 0,
  ]);
  const [videoUrl, setVideoUrl] = createSignal('');
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
    getMediaUrl({
      type: props.srcType,
      id: props.id,
      url: props.url,
    }).then((maybeUrl) => {
      if (isErr(maybeUrl)) {
        setState('error');
        if (isErr(maybeUrl, 'UNAUTHORIZED')) setVideoError('UNAUTHORIZED');
        else if (isErr(maybeUrl, 'MISSING')) setVideoError('MISSING');
        else if (isErr(maybeUrl, 'GONE')) setVideoError('GONE');
        else setVideoError('FALLBACK');
        return;
      }
      const url = maybeUrl[1];
      setVideoUrl(url);
      if (props.srcType === 'dss') {
        editor()?.update(
          () => {
            $upgradeDSSMediaUrl(props.key, url, 'video');
          },
          { discrete: true, tag: 'historic' }
        );
      }
    });
  });

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const clickVideoHandler = () => {
    const _editor = editor();
    if (_editor === undefined) return;
    if (!_editor.isEditable()) return;
    if (isSelectedAsNode()) return;
    _editor.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const deleteVideo = () => {
    const _editor = editor();
    if (_editor === undefined) return;
    _editor.update(() => {
      let node = $getNodeByKey(props.key);
      if (!node) return;
      const nextSibling = node.getNextSibling();
      const prevSibling = node.getPreviousSibling();
      const root = $getRoot();

      node.remove();
      if (nextSibling) {
        nextSibling.selectStart();
      } else if (prevSibling) {
        prevSibling.selectEnd();
      } else {
        root.selectEnd();
      }
    });
  };

  const viewFull = () => {
    if (state() === 'ok') {
      setViewerOpen(true);
    }
  };

  const loadVideo = () => {
    setState('ok');
    setVideoDims([videoRef.videoWidth, videoRef.videoHeight]);
    editor()?.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
      props.key,
      {
        width: videoRef.videoWidth,
        height: videoRef.videoHeight,
      },
      'video',
    ]);
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
    const e = editor();
    if (e) {
      cleanupListners = mergeRegister(
        e.registerCommand(
          UPLOAD_MEDIA_START_COMMAND,
          ([key]) => {
            if (key !== props.key) return false;
            setUploading(true);
            return true;
          },
          COMMAND_PRIORITY_LOW
        ),
        e.registerCommand(
          UPLOAD_MEDIA_SUCCESS_COMMAND,
          ([key]) => {
            if (key !== props.key) return false;
            setUploading(false);
            return true;
          },
          COMMAND_PRIORITY_LOW
        ),
        e.registerCommand(
          UPLOAD_MEDIA_FAILURE_COMMAND,
          ([key]) => {
            if (key !== props.key) return false;
            setUploading(false);
            toast.failure('Failed to upload video');
            return true;
          },
          COMMAND_PRIORITY_LOW
        )
      );

      setTimeout(() => {
        e.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
          props.key,
          'video',
        ]);
      }, 10);
    }
  });

  onCleanup(() => {
    videoRef.removeEventListener('loadeddata', loadVideo);
    videoRef.removeEventListener('error', onVideoError);
    cleanupListners();
  });

  const debouncedScale = debouncedDependent(scale, 60);
  createEffect(() => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (node && $isVideoNode(node)) {
        node.setScale(debouncedScale(), false);
      }
    });
  });

  const debouncedSetHover = debounce((state: boolean) => {
    setVideoHover(state);
  }, 300);

  return (
    <Dialog open={viewerOpen()} onOpenChange={setViewerOpen}>
      <div
        ref={containerRef}
        class="relative max-w-full my-4 grid place-items-center mx-auto"
        classList={{
          'bracket-offset-4 bracket': isSelectedAsNode(),
          'media-error min-h-44': state() === 'error',
        }}
        style={{
          'max-height': `${videoDims() ? videoDims()[1] * scale() : 640}px`,
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
        <Show when={state() === 'ok' && editor()?.isEditable()}>
          <ResizeHandle
            scale={scale}
            setScale={setScale}
            side="left"
            imageDims={videoDims}
            containerRef={containerRef}
          />
          <ResizeHandle
            scale={scale}
            setScale={setScale}
            side="right"
            imageDims={videoDims}
            containerRef={containerRef}
          />
        </Show>
        <video
          crossorigin="anonymous"
          class="h-full object-contain"
          draggable={false}
          classList={{
            invisible: state() === 'loading' || state() === 'error',
          }}
          ref={videoRef}
          src={videoUrl()}
          controls={state() === 'ok'}
          style={{
            width: `${videoDims()[0] ? videoDims()[0] * scale() : 'auto'}px`,
          }}
        />

        <Show when={state() === 'error'}>
          <div class="absolute top-0 left-0 w-full h-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted min-h-44">
            <VideoIcon class="size-5" />
            <div>{VideoErrors[videoError() ?? 'FALLBACK']}</div>
          </div>
        </Show>

        <Show when={state() === 'loading'}>
          <div class="absolute top-0 left-0 w-full h-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted">
            <Spinner />
          </div>
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
          <div class="w-full h-full absolute top-0 left-0 pointer-events-none bg-edge/20" />
          <MediaButtons
            delete={interactable() ? deleteVideo : undefined}
            enlarge={state() === 'ok' ? viewFull : undefined}
            newTab={
              state() === 'ok'
                ? () => {
                    window.open(videoUrl(), '_blank');
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
            <div class="absolute bg-dialog top-2 right-2 flex flex-row z-10">
              <Dialog.CloseButton>
                <IconButton icon={XIcon} theme="clear" />
              </Dialog.CloseButton>
            </div>
            <video
              crossorigin="anonymous"
              class="max-w-full max-h-[80vh] w-auto h-auto object-contain"
              controls
              src={videoUrl()}
            />
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
