import { t } from '@app/lib/i18n';
import { usePreference } from '@app/preferences/use-preference';
import { getDisplayName, tryMacroId } from '@core/user';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import type { Participant } from 'livekit-client';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useCallContext } from './CallContext';
import { CallLiveChip } from './CallLiveChip';
import { CallQuickControls } from './CallQuickControls';
import {
  type CallPlayerCorner,
  type CallPlayerResizeEdge,
  constrainCallPlayerPosition,
  getCallPlayerSnapTarget,
  resizeCallPlayer,
  selectCallPreview,
} from './call-mini-player';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { TrackView } from './TrackView';

export function CallMiniPlayer(props: {
  onCollapse: () => void;
  onOpenCall: () => void;
}) {
  const call = useCallContext();
  const record = useLiveCallRecordQuery(() => call.activeCallId() ?? '');
  const [corner, setCorner] = createSignal<CallPlayerCorner>('bottom-right');
  const [position, setPosition] = createSignal<{ x: number; y: number }>();
  const [snapTarget, setSnapTarget] =
    createSignal<ReturnType<typeof getCallPlayerSnapTarget>>();
  const [snapping, setSnapping] = createSignal(false);
  const [storedWidth, setWidth] = usePreference(
    'macro:pref:call:mini-player-width',
    { default: 336 }
  );
  const [storedAudioHeight, setAudioHeight] = usePreference(
    'macro:pref:call:mini-player-audio-height',
    { default: 144 }
  );
  const [previewSize, setPreviewSize] = createSignal<{
    width: number;
    audioHeight: number;
  }>();
  const [viewport, setViewport] = createSignal({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const onViewportResize = () => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    setSnapping(false);
    const box = root.getBoundingClientRect();
    setPosition((point) =>
      point
        ? constrainCallPlayerPosition(
            point.x,
            point.y,
            box.width,
            box.height,
            window.innerWidth,
            window.innerHeight
          )
        : point
    );
  };
  window.addEventListener('resize', onViewportResize);
  onCleanup(() => window.removeEventListener('resize', onViewportResize));
  let root!: HTMLDivElement;
  let media: HTMLDivElement | undefined;
  onMount(() => {
    const observer = new ResizeObserver(() => {
      const box = root.getBoundingClientRect();
      setPosition((previous) => {
        if (!previous) return previous;
        const next = constrainCallPlayerPosition(
          previous.x,
          previous.y,
          box.width,
          box.height,
          window.innerWidth,
          window.innerHeight
        );
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
    });
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  let resize:
    | {
        pointer: number;
        x: number;
        y: number;
        edge: CallPlayerResizeEdge;
        box: { x: number; y: number; width: number; height: number };
        mediaHeight: number;
        audioOnly: boolean;
        corner: CallPlayerCorner;
      }
    | undefined;
  const candidates = createMemo(() => {
    call.trackVersion();
    const room = call.room();
    if (!room) return [];
    const preview = (
      participant: Participant,
      local: boolean,
      speaking: boolean
    ) => {
      const camera = participant.getTrackPublication(LK_TRACK_SOURCE.Camera);
      const screen = participant.getTrackPublication(
        LK_TRACK_SOURCE.ScreenShare
      );
      return {
        id: participant.identity,
        name: local
          ? t('calls.you')
          : participant.name?.trim() ||
            getDisplayName(tryMacroId(participant.identity)) ||
            t('calls.guest'),
        speaking,
        hasVideo: !!camera?.track && !camera.isMuted,
        sharing: !!screen?.track && !screen.isMuted,
        camera: camera?.track,
        screen: screen?.track,
        local,
      };
    };
    return [
      ...Array.from(call.remoteParticipants().values())
        .filter((participant) => !participant.isAgent)
        .map((participant) =>
          preview(participant, false, call.isParticipantSpeaking(participant))
        ),
      preview(room.localParticipant, true, call.isLocalSpeaking()),
    ];
  });
  const selected = () => selectCallPreview(candidates());
  const audioOnly = () =>
    !candidates().some(
      (participant) => participant.hasVideo || participant.sharing
    );
  const title = () =>
    record.isSuccess
      ? record.data.channelName || t('nav.returnToCall')
      : t('nav.returnToCall');
  const width = () => {
    const maximum = Math.max(
      0,
      Math.min(
        640,
        viewport().width - 24,
        audioOnly() ? Infinity : ((viewport().height - 180) * 16) / 9 + 16
      )
    );
    return Math.max(
      Math.min(256, maximum),
      Math.min(previewSize()?.width ?? storedWidth(), maximum)
    );
  };
  const placement = () => {
    const point = position();
    if (point) return { left: `${point.x}px`, top: `${point.y}px` };
    return {
      [corner().endsWith('left') ? 'left' : 'right']: '20px',
      [corner().startsWith('top') ? 'top' : 'bottom']: '20px',
    };
  };
  const finishDrag = (cancelled = false) => {
    if (!drag) return;
    const box = root.getBoundingClientRect();
    const target = cancelled
      ? undefined
      : getCallPlayerSnapTarget(
          box.x,
          box.y,
          box.width,
          box.height,
          window.innerWidth,
          window.innerHeight
        );
    if (target) {
      setCorner(target.corner);
      setSnapping(true);
      setPosition({ x: target.x, y: target.y });
    }
    setSnapTarget(undefined);
    drag = undefined;
  };
  const finishResize = (event: PointerEvent, cancelled = false) => {
    if (!resize || resize.pointer !== event.pointerId) return;
    const preview = previewSize();
    if (!cancelled && preview) {
      setWidth(preview.width);
      if (resize.audioOnly) setAudioHeight(preview.audioHeight);
    } else if (cancelled) {
      setPosition({ x: resize.box.x, y: resize.box.y });
    }
    setPreviewSize(undefined);
    resize = undefined;
  };
  return (
    <Portal>
      <Show when={snapTarget()}>
        {(target) => (
          <div
            aria-hidden="true"
            data-call-snap-target
            class="pointer-events-none fixed z-modal rounded-2xl border-2 border-success bg-success/10"
            style={{
              left: `${target().x}px`,
              top: `${target().y}px`,
              width: `${target().width}px`,
              height: `${target().height}px`,
            }}
          />
        )}
      </Show>
      <div
        ref={root}
        role="region"
        aria-label={title()}
        class={cn(
          'menu-surface fixed z-modal max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl',
          snapping() &&
            'transition-[left,top] duration-200 ease-out motion-reduce:transition-none'
        )}
        onTransitionEnd={(event) => {
          if (event.target === root) setSnapping(false);
        }}
        style={{ ...placement(), width: `${width()}px` }}
      >
        <div
          class="flex touch-none cursor-grab items-center gap-2 px-3 py-2"
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              (event.target instanceof Element &&
                event.target.closest('button'))
            )
              return;
            setSnapping(false);
            setSnapTarget(undefined);
            const box = root.getBoundingClientRect();
            setPosition({ x: box.x, y: box.y });
            drag = {
              x: event.clientX,
              y: event.clientY,
              left: box.left,
              top: box.top,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag) return;
            const box = root.getBoundingClientRect();
            const point = constrainCallPlayerPosition(
              drag.left + event.clientX - drag.x,
              drag.top + event.clientY - drag.y,
              box.width,
              box.height,
              window.innerWidth,
              window.innerHeight
            );
            setPosition(point);
            setSnapTarget(
              getCallPlayerSnapTarget(
                point.x,
                point.y,
                box.width,
                box.height,
                window.innerWidth,
                window.innerHeight
              )
            );
          }}
          onPointerUp={() => finishDrag()}
          onPointerCancel={() => finishDrag(true)}
          onLostPointerCapture={() => finishDrag(true)}
        >
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">
            {title()}
          </span>
          <CallLiveChip
            callId={call.activeCallId() ?? undefined}
            bare
            startedAt={record.isSuccess ? record.data.startedAt : undefined}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('calls.collapsePlayer')}
            onClick={props.onCollapse}
          >
            <CornersIn class="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('nav.returnToCall')}
            onClick={props.onOpenCall}
          >
            <ArrowSquareOut class="size-4" />
          </Button>
        </div>
        <Show when={selected()}>
          {(participant) => (
            <div
              ref={media}
              style={
                audioOnly()
                  ? {
                      height: `${Math.min(previewSize()?.audioHeight ?? storedAudioHeight(), Math.max(144, viewport().height - 180))}px`,
                    }
                  : undefined
              }
              class={cn(
                'relative mx-2 flex items-center justify-center overflow-hidden rounded-xl bg-panel',
                audioOnly() ? 'min-h-36 gap-3 px-5 py-4' : 'aspect-video',
                participant().speaking &&
                  'outline-2 -outline-offset-2 outline-success'
              )}
            >
              <Show
                when={participant().sharing && !participant().local}
                fallback={
                  <Show
                    when={participant().hasVideo}
                    fallback={
                      <span
                        class={cn(
                          'flex shrink-0 items-center justify-center rounded-full bg-ink-extra-muted text-surface text-lg font-semibold',
                          audioOnly() ? 'size-12' : 'size-10',
                          participant().speaking &&
                            'outline-2 -outline-offset-2 outline-success'
                        )}
                      >
                        {participant().name.charAt(0).toUpperCase()}
                      </span>
                    }
                  >
                    <TrackView
                      track={participant().camera}
                      mirror={participant().local}
                    />
                  </Show>
                }
              >
                <TrackView track={participant().screen} fit="contain" />
              </Show>
              <span
                class={cn(
                  'text-sm',
                  !audioOnly() &&
                    'absolute bottom-2 left-2 rounded bg-surface/80 px-2 py-1'
                )}
              >
                <Show when={participant().sharing}>
                  <Screencast class="mr-1 inline size-3" />
                </Show>
                <Show
                  when={participant().sharing}
                  fallback={participant().name}
                >
                  {participant().local
                    ? t('calls.youAreSharing')
                    : t('calls.presenterSharing', { name: participant().name })}
                </Show>
                <Show when={audioOnly() && participant().speaking}>
                  <span class="block text-xs text-success">
                    {t('calls.speaking')}
                  </span>
                </Show>
              </span>
            </div>
          )}
        </Show>
        <CallQuickControls controls={['camera', 'screen']} />
        <For
          each={
            [
              'top',
              'bottom',
              'left',
              'right',
              'top-left',
              'top-right',
              'bottom-left',
              'bottom-right',
            ] as CallPlayerResizeEdge[]
          }
        >
          {(edge) => (
            <div
              role="separator"
              aria-label={t('channelSections.resizeSection', { name: title() })}
              aria-orientation={
                edge === 'top' || edge === 'bottom' ? 'horizontal' : 'vertical'
              }
              class="absolute z-20 touch-none"
              classList={{
                'top-0': edge.includes('top'),
                'bottom-0': edge.includes('bottom'),
                'left-0': edge.includes('left'),
                'right-0': edge.includes('right'),
                'inset-x-3': edge === 'top' || edge === 'bottom',
                'h-2': edge === 'top' || edge === 'bottom',
                'cursor-row-resize': edge === 'top' || edge === 'bottom',
                'inset-y-3': edge === 'left' || edge === 'right',
                'w-2': edge === 'left' || edge === 'right',
                'cursor-col-resize': edge === 'left' || edge === 'right',
                'size-3': edge.includes('-'),
                'cursor-nwse-resize':
                  edge === 'top-left' || edge === 'bottom-right',
                'cursor-nesw-resize':
                  edge === 'top-right' || edge === 'bottom-left',
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setSnapping(false);
                const box = root.getBoundingClientRect();
                resize = {
                  pointer: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  edge,
                  box: {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                  },
                  mediaHeight: media?.getBoundingClientRect().height ?? 0,
                  audioOnly: audioOnly(),
                  corner: corner(),
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!resize || resize.pointer !== event.pointerId) return;
                const result = resizeCallPlayer(
                  resize.edge,
                  resize.box,
                  resize.mediaHeight,
                  event.clientX - resize.x,
                  event.clientY - resize.y,
                  window.innerWidth,
                  window.innerHeight,
                  resize.audioOnly,
                  resize.corner
                );
                setPreviewSize({
                  width: result.width,
                  audioHeight: result.mediaHeight,
                });
                setPosition({ x: result.x, y: result.y });
              }}
              onPointerUp={(event) => finishResize(event)}
              onPointerCancel={(event) => finishResize(event, true)}
              onLostPointerCapture={(event) => finishResize(event, true)}
            />
          )}
        </For>
      </div>
    </Portal>
  );
}
