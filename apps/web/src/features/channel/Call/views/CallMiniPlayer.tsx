import { t } from '@app/lib/i18n';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { createMediaQuery } from '@solid-primitives/media';
import { Button, cn, Dropdown } from '@ui';
import type { Participant } from 'livekit-client';
import { createMemo, For, Show, untrack } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Transition } from 'solid-transition-group';
import { useCallContext } from '../CallContext';
import { CallLiveChip } from '../components/CallLiveChip';
import { CallReactionLayer } from '../components/CallReactionLayer';
import { MutedForYouBadge } from '../components/MutedForYouBadge';
import { useCallVolumeOptional } from '../context/call-volume';
import type { CallPlayerResizeEdge } from '../core/call-mini-player';
import { LK_TRACK_SOURCE } from '../livekit-loader';
import { MutedMicrophoneBadge } from '../MutedMicrophoneBadge';
import { createHeldCallPreview } from '../primitives/call-mini-player-selection';
import { createCallMiniPlayer } from '../primitives/create-call-mini-player';
import { createCallReactions } from '../primitives/create-call-reactions';
import { TrackView } from '../TrackView';
import { CallParticipantVolume } from './CallParticipantVolume';
import { CallQuickControls } from './CallQuickControls';

export function CallMiniPlayer(props: {
  onCollapse: () => void;
  onOpenCall: () => void;
}) {
  const call = useCallContext();
  const volumes = useCallVolumeOptional();
  const reactions = createCallReactions(call.room);
  const record = useLiveCallRecordQuery(() => call.activeCallId() ?? '');
  let root!: HTMLDivElement;
  let media: HTMLDivElement | undefined;
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
        muted: local
          ? call.isAudioMuted()
          : (participant.getTrackPublication(LK_TRACK_SOURCE.Microphone)
              ?.isMuted ?? true),
        mutedForYou: !local && volumes?.level(participant) === 0,
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
  const reducedMotion = createMediaQuery('(prefers-reduced-motion: reduce)');
  const selected = createHeldCallPreview(candidates, reducedMotion);
  const audioOnly = () =>
    !candidates().some(
      (participant) => participant.hasVideo || participant.sharing
    );
  const title = () =>
    record.isSuccess
      ? record.data.channelName || t('nav.returnToCall')
      : t('nav.returnToCall');
  const player = createCallMiniPlayer({
    root: () => root,
    media: () => media,
    audioOnly,
    reducedMotion,
  });
  const { placement } = player;
  return (
    <Portal>
      <Show when={player.visibleSnapTarget()}>
        {(target) => (
          <div
            aria-hidden="true"
            data-call-snap-target
            class="pointer-events-none fixed z-modal transition-[opacity,visibility] duration-150 motion-reduce:transition-none starting:opacity-0"
            classList={{ 'invisible opacity-0': !placement.snapTarget }}
            style={{
              opacity: placement.snapTarget?.opacity ?? 0,
              left: target().corner.endsWith('left') ? '0px' : 'auto',
              right: target().corner.endsWith('right') ? '0px' : 'auto',
              top: target().corner.startsWith('top') ? '0px' : 'auto',
              bottom: target().corner.startsWith('bottom') ? '0px' : 'auto',
              width: `${target().width + 80}px`,
              height: `${target().height + 80}px`,
              background: `radial-gradient(ellipse at ${target().corner.endsWith('left') ? 'left' : 'right'} ${target().corner.startsWith('top') ? 'top' : 'bottom'}, color-mix(in oklch, var(--color-success) 18%, transparent), transparent 75%)`,
            }}
          >
            <div
              class="absolute inset-x-0 h-0.5"
              style={{
                top: target().corner.startsWith('top') ? '0px' : 'auto',
                bottom: target().corner.startsWith('bottom') ? '0px' : 'auto',
                background: `linear-gradient(to ${target().corner.endsWith('left') ? 'right' : 'left'}, var(--color-success), transparent)`,
              }}
            />
            <div
              class="absolute inset-y-0 w-0.5"
              style={{
                left: target().corner.endsWith('left') ? '0px' : 'auto',
                right: target().corner.endsWith('right') ? '0px' : 'auto',
                background: `linear-gradient(to ${target().corner.startsWith('top') ? 'bottom' : 'top'}, var(--color-success), transparent)`,
              }}
            />
          </div>
        )}
      </Show>
      <div
        ref={root}
        role="region"
        aria-label={title()}
        class={cn(
          'menu-surface fixed z-modal max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-x-hidden overflow-y-auto rounded-2xl',
          placement.snapping &&
            'transition-[left,top] duration-200 ease-out motion-reduce:transition-none'
        )}
        onTransitionEnd={player.onTransitionEnd}
        style={{ ...player.positionStyle(), width: `${player.width()}px` }}
      >
        <div
          class="flex touch-none cursor-grab items-center gap-2 px-3 py-2"
          onPointerDown={player.onDragStart}
          onPointerMove={player.onDragMove}
          onPointerUp={(event) => player.finishDrag(event)}
          onPointerCancel={(event) => player.finishDrag(event, true)}
          onLostPointerCapture={(event) => player.finishDrag(event, true)}
        >
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">
            {title()}
          </span>
          <CallLiveChip
            callId={call.activeCallId() ?? undefined}
            bare
            startedAt={record.isSuccess ? record.data.startedAt : undefined}
          />
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              variant="ghost"
              size="icon-xs"
              aria-label={t('calls.more')}
            >
              <DotsThree class="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Group>
                <Dropdown.Item
                  disabled={player.atDefaults()}
                  onSelect={player.resetPlayer}
                >
                  <ArrowCounterClockwise class="size-4" />
                  <span>{t('calls.resetPlayer')}</span>
                </Dropdown.Item>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
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
                      height: `${player.mediaHeight()}px`,
                    }
                  : undefined
              }
              class={cn(
                'relative mx-2 flex items-center justify-center overflow-hidden rounded-xl bg-panel',
                audioOnly() ? 'min-h-36' : 'aspect-video',
                participant().speaking &&
                  'outline-2 -outline-offset-2 outline-success'
              )}
            >
              <Transition
                onEnter={(element, done) =>
                  player.animatePreview(element, done, true)
                }
                onExit={(element, done) =>
                  player.animatePreview(element, done, false)
                }
                onBeforeExit={(element) => {
                  element.setAttribute('inert', '');
                  element.setAttribute('aria-hidden', 'true');
                }}
              >
                <Show when={selected()?.id} keyed>
                  {(id) => {
                    const initial = untrack(selected);
                    if (!initial) return null;
                    const participant = () =>
                      candidates().find((person) => person.id === id) ??
                      initial;
                    const shareLabel = () => {
                      if (participant().local) return t('calls.youAreSharing');
                      return t('calls.presenterSharing', {
                        name: participant().name,
                      });
                    };
                    return (
                      <div
                        data-call-player-participant={id}
                        class={cn(
                          'absolute inset-0 flex items-center justify-center',
                          audioOnly() && 'gap-3 px-5 py-4'
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
                                    'relative flex shrink-0 items-center justify-center rounded-full bg-ink-extra-muted text-surface text-lg font-semibold',
                                    audioOnly() ? 'size-12' : 'size-10',
                                    participant().speaking &&
                                      'outline-2 -outline-offset-2 outline-success'
                                  )}
                                >
                                  {participant().name.charAt(0).toUpperCase()}
                                  <MutedForYouBadge
                                    muted={participant().mutedForYou}
                                  />
                                  <MutedMicrophoneBadge
                                    muted={participant().muted}
                                    avatar
                                  />
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
                          <TrackView
                            track={participant().screen}
                            fit="contain"
                          />
                        </Show>

                        <span
                          class={cn(
                            'text-sm',
                            !audioOnly() &&
                              'absolute bottom-2 left-2 rounded bg-surface/80 px-2 py-1'
                          )}
                        >
                          <MutedMicrophoneBadge
                            muted={participant().muted}
                            inline
                          />
                          <MutedForYouBadge
                            muted={participant().mutedForYou}
                            inline
                          />
                          <Show when={participant().sharing}>
                            <Screencast class="mr-1 inline size-3" />
                          </Show>
                          <Show
                            when={participant().sharing}
                            fallback={participant().name}
                          >
                            {shareLabel()}
                          </Show>
                        </span>
                        <Show
                          when={
                            !participant().local &&
                            call.remoteParticipants().get(participant().id)
                          }
                        >
                          {(remote) => (
                            <div class="absolute right-2 top-2">
                              <CallParticipantVolume
                                participant={remote()}
                                name={participant().name}
                              />
                            </div>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </Show>
              </Transition>
              <CallReactionLayer
                root={() => media}
                reactions={reactions.entries()}
                compact
              />
            </div>
          )}
        </Show>
        <CallQuickControls.Root>
          <CallQuickControls.Settings>
            <CallQuickControls.MediaMicrophone />
            <CallQuickControls.MediaCamera />
            <CallQuickControls.MediaScreen />
            <CallQuickControls.Reactions
              onReaction={(emoji) =>
                fireAndForget(reactions.send(emoji), 'call-mini-player')
              }
            />
            <CallQuickControls.MediaLeave />
          </CallQuickControls.Settings>
        </CallQuickControls.Root>
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
              onPointerDown={(event) => player.onResizeStart(edge, event)}
              onPointerMove={player.onResizeMove}
              onPointerUp={(event) => player.finishResize(event)}
              onPointerCancel={(event) => player.finishResize(event, true)}
              onLostPointerCapture={(event) => player.finishResize(event, true)}
            />
          )}
        </For>
      </div>
    </Portal>
  );
}
