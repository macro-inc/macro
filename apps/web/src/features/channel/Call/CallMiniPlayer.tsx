import { t } from '@app/lib/i18n';
import { getDisplayName, tryMacroId } from '@core/user';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import type { Participant } from 'livekit-client';
import { createMemo, createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useCallContext } from './CallContext';
import { CallLiveChip } from './CallLiveChip';
import { CallQuickControls } from './CallQuickControls';
import {
  type CallPlayerCorner,
  constrainCallPlayerPosition,
  nearestCallPlayerCorner,
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
  let root!: HTMLDivElement;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
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
  const placement = () => {
    const point = position();
    if (point) return { left: `${point.x}px`, top: `${point.y}px` };
    return {
      [corner().endsWith('left') ? 'left' : 'right']: '20px',
      [corner().startsWith('top') ? 'top' : 'bottom']: '20px',
    };
  };
  const finishDrag = () => {
    if (!drag) return;
    const box = root.getBoundingClientRect();
    setCorner(
      nearestCallPlayerCorner(
        box.x,
        box.y,
        box.width,
        box.height,
        window.innerWidth,
        window.innerHeight
      )
    );
    setPosition(undefined);
    drag = undefined;
  };
  return (
    <Portal>
      <div
        ref={root}
        role="region"
        aria-label={title()}
        class="menu-surface fixed z-modal w-84 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl"
        style={placement()}
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
            const box = root.getBoundingClientRect();
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
            setPosition(
              constrainCallPlayerPosition(
                drag.left + event.clientX - drag.x,
                drag.top + event.clientY - drag.y,
                box.width,
                box.height,
                window.innerWidth,
                window.innerHeight
              )
            );
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
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
      </div>
    </Portal>
  );
}
