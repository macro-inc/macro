import { clamp } from '@block-canvas/util/math';
import { withAnalytics } from '@coparse/analytics';
import { LoadErrors } from '@core/block';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { isErr } from '@core/util/maybeResult';
import PauseIcon from '@icon/regular/pause.svg';
import PlayIcon from '@icon/regular/play.svg';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import LockKey from '@phosphor-icons/core/regular/lock-key.svg?component-solid';
import Question from '@phosphor-icons/core/regular/question.svg?component-solid';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import {
  createEffect,
  createMemo,
  createReaction,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  type RenderMode,
  RenderModes,
  TOOLTIP_FONTSIZE,
} from '../../constants';
import type { ImageNode, VideoNode } from '../../model/CanvasModel';
import { useCanvasNodes } from '../../store/canvasData';
import { useRenderState } from '../../store/RenderState';
import { getBorderRadius } from '../../util/style';
import { BaseCanvasRectangle } from './BaseCanvasRectangle';

type MediaNode = ImageNode | VideoNode;

function ErrorMessage(props: {
  node: MediaNode;
  error: 'UNAUTHORIZED' | 'MISSING' | 'INVALID' | 'LOADING' | undefined;
  size: { width: number; height: number };
}) {
  const { currentScale } = useRenderState();
  const iconSize = 24;
  const tooSmall = createMemo(
    () =>
      props.size.width * currentScale() < 150 ||
      props.size.height * currentScale() < 150
  );
  const bottomMargin = !tooSmall() ? 8 : 0;
  const textColor = 'text-ink';
  const visibilityScreen =
    'w-full h-full bg-menu/50 flex flex-col items-center justify-center';

  return (
    <div
      class="flex flex-col w-full h-full text-center bg-menu/40 rounded border border-dashed border-edge items-center justify-center"
      style={{
        'border-radius': getBorderRadius(props.node),
        'font-size': TOOLTIP_FONTSIZE / currentScale() + 'px',
        'background-size':
          15 / currentScale() + 'px ' + 15 / currentScale() + 'px',
        'background-blend-mode': 'lighten',
        'background-image':
          props.error === 'LOADING'
            ? 'none'
            : 'linear-gradient(-45deg, transparent 10%, var(--color-gray-100) 10%, var(--color-gray-100) 20%, transparent 10%, transparent 60%, var(--color-gray-100) 60%, var(--color-gray-100) 70%, transparent 70%, transparent)',
      }}
    >
      <Switch>
        <Match when={props.error === 'UNAUTHORIZED'}>
          <div class={visibilityScreen}>
            <LockKey
              width={iconSize / currentScale() + 'px'}
              class="fill-ink bg-menu rounded-full"
              style={{
                'margin-bottom': bottomMargin / currentScale() + 'px',
              }}
            />
            {!tooSmall() ? (
              <div class={textColor}>
                Unauthorized: <br />
                Invalid permissions
              </div>
            ) : null}
          </div>
        </Match>
        <Match when={props.error === 'MISSING'}>
          <div class={visibilityScreen}>
            <Question
              width={iconSize / currentScale() + 'px'}
              class="fill-ink bg-menu rounded-full"
              style={{
                'margin-bottom': bottomMargin / currentScale() + 'px',
              }}
            />
            {!tooSmall() ? (
              <div class={textColor}>Error: Missing image</div>
            ) : null}
          </div>
        </Match>
        <Match when={props.error === 'INVALID'}>
          <div class={visibilityScreen}>
            <Question
              width={iconSize / currentScale() + 'px'}
              class="fill-ink bg-menu rounded-full"
              style={{
                'margin-bottom': bottomMargin / currentScale() + 'px',
              }}
            />
            {!tooSmall() ? (
              <div class={textColor}>Error: Invalid image</div>
            ) : null}
          </div>
        </Match>
        <Match when={props.error === 'LOADING'}>
          <CircleSpinner />
        </Match>
      </Switch>
    </div>
  );
}

export function DSSMedia(props: { node: MediaNode; mode: RenderMode }) {
  const imageFlip = createMemo((): Partial<JSX.CSSProperties> => {
    return {
      transform: `scaleX(${props.node.flipX ? '-1' : '1'}) scaleY(${props.node.flipY ? '-1' : '1'})`,
    };
  });

  const { track, TrackingEvents } = withAnalytics();

  const [url, setUrl] = createSignal('');
  const [error, setError] = createSignal<
    'UNAUTHORIZED' | 'MISSING' | 'INVALID' | 'LOADING' | undefined
  >('LOADING');
  const [originalSize, setOriginalSize] = createSignal<{
    width: number;
    height: number;
  }>();
  const { updateNode } = useCanvasNodes();
  const { currentSize, currentScale } = useRenderState();
  const [videoIsPlaying, setVideoIsPlaying] = createSignal(false);
  const [, setShowVideoControls] = createSignal(false);
  const [hoveringOverVideo, setHoveringOverVideo] = createSignal(false);

  let videoRef: HTMLVideoElement | undefined;

  const handleVideoRewind = () => {
    if (props.node.type !== 'video' || !videoRef) {
      return;
    }

    videoRef.currentTime = 0;
  };

  // Handle video click for play/pause
  const handleVideoClick = () => {
    if (props.node.type !== 'video' || !videoRef) {
      return;
    }

    if (videoRef.paused) {
      setVideoIsPlaying(() => true);
      videoRef.play().catch((error: Error) => {
        setVideoIsPlaying(() => false);
        console.error('Failed to play video:', error);
      });
    } else {
      setVideoIsPlaying(() => false);
      videoRef.pause();
    }
  };

  createEffect(async () => {
    if (props.node.status === 'dss' || !props.node.status) {
      const res = await storageServiceClient.getBinaryDocument({
        documentId: props.node.uuid,
      });

      if (isErr(res, 'UNAUTHORIZED') || isErr(res, 'HTTP_ERROR')) {
        setError();
        setError('UNAUTHORIZED');
        return LoadErrors.UNAUTHORIZED;
      }
      if (isErr(res)) {
        setError();
        setError('MISSING');
        return LoadErrors.MISSING;
      }

      const [, documentResult] = res;

      const { blobUrl } = documentResult;

      const blobResult = await fetchBinary(blobUrl, 'blob');

      if (isErr(blobResult)) {
        return LoadErrors.MISSING;
      }

      const url = URL.createObjectURL(blobResult[1]);
      setUrl(url);
      setError();

      if (props.node.type === 'image') {
        const img = new Image();
        img.src = url;
        img.onload = () => {
          setOriginalSize({ width: img.width, height: img.height });
        };
      } else if (props.node.type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.oncanplay = () => {
          setOriginalSize({
            width: video.videoWidth,
            height: video.videoHeight,
          });
        };
      }
    } else if (props.node.status === 'static') {
      // Get from sfs
      const imageUrl = () => {
        return staticFileIdEndpoint(props.node.uuid);
      };
      setUrl(imageUrl());
      const img = new Image();
      img.src = props.node.uuid;
      img.onload = () => {
        setOriginalSize({ width: img.width, height: img.height });
      };

      setError();
    } else if (props.node.status === 'loading') {
      // temporarily load from blob
      setUrl(props.node.uuid);
      const img = new Image();
      img.src = props.node.uuid;
      img.onload = () => {
        setOriginalSize({ width: img.width, height: img.height });
      };
      setError();
    }
  });

  const updateSize = createReaction(() => {
    const canvasWidth = currentSize().x / 2 / currentScale();
    const canvasHeight = currentSize().y / 2 / currentScale();

    if (props.mode === RenderModes.Preview) return;
    if (props.node.width !== 0 && props.node.height !== 0) return;
    else if (!originalSize()) return;
    else {
      const width = originalSize()!.width;
      const height = originalSize()!.height;
      if (width < canvasWidth && height < canvasHeight) {
        return updateNode(props.node.id, {
          width,
          height,
          x: props.node.x - width / 2,
          y: props.node.y - height / 2,
          flipX: false,
          flipY: false,
        });
      } else {
        const widthRatio = width / canvasWidth;
        const heightRatio = height / canvasHeight;
        if (widthRatio <= heightRatio) {
          updateNode(props.node.id, {
            width: canvasWidth,
            height: height / widthRatio,
            x: props.node.x - canvasWidth / 2,
            y: props.node.y - height / widthRatio / 2,
            flipX: false,
            flipY: false,
          });
        } else if (heightRatio < widthRatio) {
          updateNode(props.node.id, {
            width: width / heightRatio,
            height: canvasHeight,
            x: props.node.x - width / heightRatio / 2,
            y: props.node.y - canvasHeight / 2,
            flipX: false,
            flipY: false,
          });
        }
      }
    }
  });
  updateSize(() => originalSize());

  const size = () => ({
    width: clamp(40 / currentScale(), 4, 100) + 'px',
    height: clamp(40 / currentScale(), 4, 100) + 'px',
    padding: 10 / currentScale() + 'px',
  });
  const renderMedia = () => {
    if (props.node.type === 'image') {
      return (
        <img
          src={url()}
          style={{
            ...imageFlip(),
            width: props.node.width + 'px',
            height: props.node.height + 'px',
          }}
          alt={''}
        />
      );
    } else if (props.node.type === 'video') {
      const controlIcon = videoIsPlaying() ? (
        <PauseIcon class="size-full" />
      ) : (
        <PlayIcon class="size-full" />
      );
      return (
        <div
          class="relative w-full h-full pointer-events-auto"
          style={{
            width: props.node.width + 'px',
            height: props.node.height + 'px',
          }}
          onMouseEnter={() => {
            setHoveringOverVideo(() => true);
          }}
          onMouseLeave={() => {
            setHoveringOverVideo(() => false);
          }}
        >
          {
            // TODO: pull out as renderPlayControls()
            (hoveringOverVideo() || !videoIsPlaying()) && (
              <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex pointer-events-auto cursor-auto">
                <div
                  onPointerDown={handleVideoRewind}
                  class="text-panel bg-edge/50 rounded-full flex items-center justify-center"
                  style={{
                    'margin-right': 10 / currentScale() + 'px',
                    ...size(),
                  }}
                >
                  <ArrowCounterClockwise class="size-full" style={{}} />
                </div>
                <div
                  onPointerDown={handleVideoClick}
                  class="text-panel bg-edge/50 rounded-full flex items-center justify-center"
                  style={size()}
                >
                  {controlIcon}
                </div>
              </div>
            )
          }

          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              'object-fit': 'fill',
              ...imageFlip(),
            }}
            src={url()}
            onError={(e) => {
              track(TrackingEvents.BLOCKVIDEO.PLAYBACK.ERROR, { error: e });
            }}
            controls={false}
            onplay={() => {
              setShowVideoControls(() => true);
            }}
            onpause={() => {
              setShowVideoControls(() => false);
            }}
            loop
          />
        </div>
      );
    }
  };

  return (
    <BaseCanvasRectangle
      node={props.node}
      mode={props.mode}
      clickable={true}
      useSimpleSelectionBox={false}
    >
      <div
        class="w-full h-full overflow-hidden"
        style={{
          'border-radius': getBorderRadius(props.node),
          'border-color':
            props.node.style?.fillColor === 'transparent'
              ? 'transparent'
              : (props.node.style?.strokeColor ?? 'transparent'),
          'border-width': `${props.node.style?.strokeWidth ?? 2}px`,
          'border-style': 'solid',
        }}
      >
        <Show
          when={!error()}
          fallback={
            <ErrorMessage
              error={error()}
              node={props.node}
              size={{ width: props.node.width, height: props.node.height }}
            />
          }
        >
          {renderMedia()}
        </Show>
      </div>
    </BaseCanvasRectangle>
  );
}
