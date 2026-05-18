import { internalDrag } from '@core/directive/internalDragState';

false && internalDrag;

import { toast } from '@core/component/Toast/Toast';
import { debouncedDependent } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { Dialog } from '@kobalte/core/dialog';
import { mergeRegister } from '@lexical/utils';
import { $isImageNode, type ImageDecoratorProps } from '@lexical-core';
import { calculateEffectiveDimensions } from '@lexical-core/utils/media';
import ImageIcon from '@phosphor/image-broken.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn, Layer } from '@ui';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
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
} from '../../plugins/media';
import { MediaButtons } from './MediaButtons';
import { ResizeHandle } from './ResizeHandle';

type ImageState = 'loading' | 'ok' | 'error';

const ImageErrors = {
  UNAUTHORIZED: 'You do not have access to this image.',
  MISSING: 'This image does not exist.',
  GONE: 'This image has been deleted.',
  FALLBACK: 'This image could not be found.',
} as const;
type ImageError = keyof typeof ImageErrors;

function Spinner() {
  return (
    <div class="animate-spin size-5">
      <LoadingSpinner class="size-5" />
    </div>
  );
}

export function MarkdownImage(props: ImageDecoratorProps) {
  let imageRef!: HTMLImageElement;
  let containerRef!: HTMLDivElement;

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;
  const editor = () => lexicalWrapper?.editor;
  const interactable = () => lexicalWrapper?.isInteractable() ?? false;

  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [imageHover, setImageHover] = createSignal(false);
  const [uploading, setUploading] = createSignal(props.srcType === 'local');
  const [imageDims, setImageDims] = createSignal<[number, number]>([
    props.width || 0,
    props.height || 0,
  ]);
  const [imageUrl, setImageUrl] = createSignal('');
  const [state, setState] = createSignal<ImageState>('loading');
  const [imageError, setImageError] = createSignal<ImageError | undefined>();

  const [scale, setScale] = createSignal(props.scale);

  // Calculate effective dimensions from props
  const effectiveDims = createMemo(() => {
    const dims = calculateEffectiveDimensions(
      imageDims()[0],
      imageDims()[1],
      props.constrainedWidth,
      props.constrainedHeight
    );
    return [dims.width, dims.height] as [number, number];
  });

  createEffect(() => {
    if (props.srcType === 'local') {
      setImageUrl(props.url);
      return;
    }
    if (props.srcType === 'url') {
      setImageUrl(props.url);
      return;
    }
    getMediaUrl({
      type: props.srcType,
      id: props.id,
      url: props.url,
    }).then((maybeUrl) => {
      if (isErr(maybeUrl)) {
        setState('error');
        if (isErr(maybeUrl, 'UNAUTHORIZED')) setImageError('UNAUTHORIZED');
        else if (isErr(maybeUrl, 'MISSING')) setImageError('MISSING');
        else if (isErr(maybeUrl, 'GONE')) setImageError('GONE');
        else setImageError('FALLBACK');
        return;
      }
      const url = maybeUrl[1];
      setImageUrl(url);
      if (props.srcType === 'dss') {
        editor()?.update(
          () => {
            $upgradeDSSMediaUrl(props.key, url, 'image');
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

  const clickImageHandler = () => {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    if (!currentEditor.isEditable()) return;
    if (isSelectedAsNode()) return;
    currentEditor.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const deleteImage = () => {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    currentEditor.update(() => {
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

  const loadImage = () => {
    setState('ok');
    setImageDims([imageRef.naturalWidth, imageRef.naturalHeight]);
    editor()?.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
      props.key,
      {
        width: imageRef.naturalWidth,
        height: imageRef.naturalHeight,
      },
      'image',
    ]);
  };

  const onImageError = () => {
    if (imageUrl()) {
      // only set error if we looked for a real url
      setState('error');
    }
  };

  let cleanupListners = () => {};

  onMount(() => {
    imageRef.addEventListener('load', loadImage);
    imageRef.addEventListener('error', onImageError);
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
            toast.failure('Failed to upload image');
            return true;
          },
          COMMAND_PRIORITY_LOW
        )
      );

      setTimeout(() => {
        e.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
          props.key,
          'image',
        ]);
      }, 10);
    }
  });

  onCleanup(() => {
    imageRef.removeEventListener('load', loadImage);
    imageRef.removeEventListener('error', onImageError);
    cleanupListners();
  });

  const debouncedScale = debouncedDependent(scale, 60);
  createEffect(
    on(debouncedScale, (value) => {
      editor()?.update(() => {
        const node = $getNodeByKey(props.key);
        if (node && $isImageNode(node)) {
          node.setScale(value, false);
        }
      });
    })
  );

  const debouncedSetHover = debounce((state: boolean) => {
    setImageHover(state);
  }, 300);

  return (
    <Dialog open={viewerOpen()} onOpenChange={setViewerOpen}>
      <div
        ref={containerRef}
        class={cn(
          'relative max-w-full my-4 grid place-items-center',
          isSelectedAsNode() && 'ring-3 ring-edge-muted',
          state() === 'error' &&
            'pattern-edge-muted pattern-diagonal-8 min-h-44',
          // If there are no constrained dimensions, center the image
          !props.constrainedWidth && !props.constrainedHeight && 'mx-auto'
        )}
        style={{
          'max-width': `${effectiveDims()[0] ? effectiveDims()[0] * scale() : 640}px`,
          'aspect-ratio':
            effectiveDims()[0] && effectiveDims()[1]
              ? `${effectiveDims()[0] / effectiveDims()[1]}`
              : 'auto',
        }}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          clickImageHandler();
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
          setImageHover(false);
        }}
      >
        <Show when={state() === 'ok' && editor()?.isEditable()}>
          <ResizeHandle
            scale={scale}
            setScale={setScale}
            side="left"
            imageDims={effectiveDims}
            containerRef={containerRef}
          />
          <ResizeHandle
            scale={scale}
            setScale={setScale}
            side="right"
            imageDims={effectiveDims}
            containerRef={containerRef}
          />
        </Show>
        <img
          crossorigin="anonymous"
          class={cn(
            'h-full object-contain',
            (state() === 'loading' || state() === 'error') && 'invisible'
          )}
          draggable={true}
          use:internalDrag={true}
          ref={imageRef}
          src={imageUrl()}
          style={{
            width: effectiveDims()[0]
              ? `${effectiveDims()[0] * scale()}px`
              : 'auto',
          }}
        />

        <Show when={state() === 'error'}>
          <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted min-h-44">
            <ImageIcon class="size-5" />
            <div>{ImageErrors[imageError() ?? 'FALLBACK']}</div>
          </div>
        </Show>

        <Show when={state() === 'loading'}>
          <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted bg-hover/50">
            <Spinner />
          </div>
        </Show>

        <Show when={uploading() && state() !== 'error'}>
          <div class="absolute flex gap-2 top-2 left-2 justify-center items-center p-2">
            <Spinner />
            Saving Image...
          </div>
        </Show>

        <Show
          when={
            (isSelectedAsNode() || imageHover()) &&
            (state() === 'ok' || state() === 'error')
          }
        >
          <Layer depth={3}>
            <div class="size-full absolute top-0 left-0 pointer-events-none bg-edge/10" />
            <MediaButtons
              delete={interactable() ? deleteImage : undefined}
              enlarge={state() === 'ok' ? viewFull : undefined}
              newTab={
                state() === 'ok'
                  ? () => {
                      window.open(imageUrl(), '_blank');
                    }
                  : undefined
              }
              containerRef={containerRef}
            />
          </Layer>
        </Show>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay items-center justify-center" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center bg-transparent">
          <Dialog.Content class="relative max-w-[65%] max-h-[80vh] flex items-center justify-center">
            <div class="absolute bg-surface top-2 right-2 flex flex-row">
              <Dialog.CloseButton>
                <Button variant="ghost" size="icon-md">
                  <XIcon />
                </Button>
              </Dialog.CloseButton>
            </div>
            <img
              crossorigin="anonymous"
              class="max-w-full max-h-[80vh] size-auto object-contain"
              src={imageUrl()}
            />
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
