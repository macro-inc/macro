import ArrowLeft from '@phosphor/arrow-left.svg';
import CornersOut from '@phosphor/corners-out.svg';
import DotsThreeVertical from '@phosphor/dots-three-vertical.svg';
import FileIcon from '@phosphor/file.svg';
import LinkIcon from '@phosphor/link.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import Sparkle from '@phosphor/sparkle.svg';
import SpeakerHigh from '@phosphor/speaker-high.svg';
import Pause from '@phosphor-fill/pause-fill.svg';
import Play from '@phosphor-fill/play-fill.svg';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import gabrielVideo from '../../../../assets/people/gabriel.webp';
import jacobVideo from '../../../../assets/people/jacob.webp';
import juliaVideo from '../../../../assets/people/julia.webp';
import teoVideo from '../../../../assets/people/teo.webp';
import { homepagePeople } from '../../core/homepage-demo-people';
import { DemoMarkdown } from '../DemoMarkdown';
import { ViewShell } from '../DemoWorkspaceChrome';
import { MessageRow } from '../workspace/frozen/MessageRow';
import {
  type CallPerson,
  type CallPosterTile,
  type CallSegment,
  callEmail,
  formatCallDuration,
  formatVideoTimestamp,
  type SampleCall,
} from './call-fixtures';

/** The largest local photo for each person, used where a camera feed shows. */
export const cameraPhoto: Record<CallPerson, string> = {
  jacob: jacobVideo,
  julia: juliaVideo,
  gabriel: gabrielVideo,
  teo: teoVideo,
  valentina: homepagePeople.valentina.photo,
};

/** Local stand-in for the recording's <video>: seeks and plays a clock only. */
export function createCallPlayback(duration: number) {
  const [seconds, setSeconds] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [seekGeneration, setSeekGeneration] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    setPlaying(false);
  };
  const play = () => {
    if (timer) return;
    setPlaying(true);
    timer = setInterval(() => {
      const next = Math.min(duration, seconds() + 1);
      setSeconds(next);
      if (next >= duration) stop();
    }, 1000);
  };
  onCleanup(stop);
  return {
    duration,
    seconds,
    playing,
    seekGeneration,
    toggle: () => (playing() ? stop() : play()),
    seek: (value: number) => {
      setSeconds(Math.max(0, Math.min(duration, value)));
      setSeekGeneration((n) => n + 1);
    },
  };
}
export type CallPlayback = ReturnType<typeof createCallPlayback>;

/** components/icon/share.svg */
export function ShareIcon(props: { class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M4 13v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4M12 14V4m-4 4 4-4 4 4" />
    </svg>
  );
}

/** CallRecordingSplitHeader: label, Call Again, Ask Macro, Share. */
export function CallRecordTopBar(props: {
  title: string;
  onBack?: () => void;
}) {
  return (
    <ViewShell.TopBar class="call-bar">
      <Show when={props.onBack}>
        <Button
          variant="plain"
          size="icon-sm"
          label="Back to channel"
          onClick={props.onBack}
        >
          <ArrowLeft />
        </Button>
      </Show>
      <PhoneCall class="size-4 shrink-0 text-ink-muted" />
      <span class="truncate text-sm font-medium">{props.title}</span>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="plain" size="icon-md" label="Call Again">
          <PhoneCall class="size-4" />
        </Button>
        <Button
          variant="plain"
          size="md"
          tooltip="Ask Macro"
          class="call-bar-action"
        >
          <Sparkle />
          <span class="call-bar-label">Ask Macro</span>
        </Button>
        <Button
          variant="plain"
          size="md"
          tooltip="Share call"
          class="call-bar-action"
        >
          <ShareIcon class="size-3.5" />
          <span class="call-bar-label">Share</span>
        </Button>
        <Button
          variant="plain"
          size="icon-md"
          label="Copy Share Link"
          class="call-bar-copy"
        >
          <LinkIcon class="size-3.5" />
        </Button>
      </div>
    </ViewShell.TopBar>
  );
}

/** A frame of the room composite, standing in for the recording's poster. */
export function RecordingPoster(props: {
  tiles: CallPosterTile[];
  speaking?: CallPerson;
}) {
  return (
    <div class="call-poster" data-count={props.tiles.length} aria-hidden="true">
      <For each={props.tiles}>
        {(tile) => (
          <div
            class="call-poster-tile"
            data-speaking={props.speaking === tile.person ? 'true' : undefined}
          >
            <Show
              when={tile.video}
              fallback={
                <span class="call-poster-avatar">
                  <img src={homepagePeople[tile.person].photo} alt="" />
                </span>
              }
            >
              <img
                class="call-poster-video"
                src={cameraPhoto[tile.person]}
                alt=""
              />
            </Show>
            <span class="call-poster-name">
              {homepagePeople[tile.person].name}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** CallRecordingVideo: the browser's own video controls over the poster. */
export function RecordingPlayer(props: {
  call: SampleCall;
  playback: CallPlayback;
}) {
  const p = () => props.playback;
  const progress = () => (p().seconds() / p().duration) * 100;
  return (
    <div class="flex flex-col items-center justify-center gap-3 overflow-hidden p-4">
      <div class="call-player" role="group" aria-label="Call recording">
        <RecordingPoster
          tiles={props.call.poster}
          speaking={props.call.speaking}
        />
        <div class="call-player-controls" data-playing={p().playing()}>
          <div
            class="call-player-timeline"
            role="slider"
            tabIndex={0}
            aria-label="Video time"
            aria-valuemin={0}
            aria-valuemax={p().duration}
            aria-valuenow={Math.floor(p().seconds())}
            aria-valuetext={formatVideoTimestamp(p().seconds())}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (!bounds.width) return;
              p().seek(
                ((event.clientX - bounds.left) / bounds.width) * p().duration
              );
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') p().seek(p().seconds() + 5);
              if (event.key === 'ArrowLeft') p().seek(p().seconds() - 5);
            }}
          >
            <span class="call-player-track">
              <span
                class="call-player-fill"
                style={{ width: `${progress()}%` }}
              />
              <span
                class="call-player-thumb"
                style={{ left: `${progress()}%` }}
              />
            </span>
          </div>
          <div class="call-player-row">
            <button
              type="button"
              class="call-player-button"
              aria-label={p().playing() ? 'Pause' : 'Play'}
              onClick={() => p().toggle()}
            >
              <Show when={p().playing()} fallback={<Play />}>
                <Pause />
              </Show>
            </button>
            <span class="call-player-time" data-call-time>
              {formatVideoTimestamp(p().seconds())} /{' '}
              {formatVideoTimestamp(p().duration)}
            </span>
            <span class="call-player-icons" aria-hidden="true">
              <SpeakerHigh />
              <CornersOut />
              <DotsThreeVertical />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lets a walkthrough scroll the transcript the way a visitor's wheel does. */
export type TranscriptControls = {
  wheelAway: () => void;
  resync: () => void;
};

function scrollBox(element: HTMLElement, top: number) {
  if (typeof element.scrollTo === 'function')
    element.scrollTo({
      top,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  else element.scrollTop = top;
}

/** CallTranscript with channel-message rows, seek on click, and follow mode. */
export function CallTranscriptBox(props: {
  segments: CallSegment[];
  playback: CallPlayback;
  maxHeight?: number;
  controls?: (controls: TranscriptControls) => void;
}) {
  let scroller!: HTMLDivElement;
  const rows = new Map<string, HTMLElement>();
  const [sync, setSync] = createSignal(true);
  const [inView, setInView] = createSignal(true);
  let ignoreScrollUntil = 0;
  const active = createMemo(() => {
    let id: string | undefined;
    for (const segment of props.segments) {
      if (segment.at <= props.playback.seconds()) id = segment.id;
      else break;
    }
    return id;
  });
  const updateInView = () => {
    const row = active() ? rows.get(active()!) : undefined;
    if (!row) {
      setInView(true);
      return;
    }
    const box = scroller.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    setInView(bounds.bottom > box.top && bounds.top < box.bottom);
  };
  const scrollToActive = (force: boolean) => {
    const row = active() ? rows.get(active()!) : undefined;
    if (!row) return;
    const box = scroller.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (!force && bounds.top >= box.top && bounds.bottom <= box.bottom) return;
    ignoreScrollUntil = performance.now() + 350;
    scrollBox(
      scroller,
      Math.max(
        0,
        scroller.scrollTop +
          (bounds.top - box.top) -
          scroller.clientHeight / 2 +
          row.clientHeight / 2
      )
    );
  };
  // A seek always re-enters follow mode and centers the line, as in the app.
  createEffect(
    on(
      () => props.playback.seekGeneration(),
      () => {
        setSync(true);
        scrollToActive(true);
        setInView(true);
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      active,
      () => {
        if (sync()) scrollToActive(false);
        else updateInView();
      },
      { defer: true }
    )
  );
  props.controls?.({
    wheelAway: () => {
      setSync(false);
      scrollBox(scroller, scroller.scrollHeight);
      updateInView();
    },
    resync: () => {
      setSync(true);
      scrollToActive(true);
      setInView(true);
    },
  });
  const grouped = (index: number) => {
    const previous = props.segments[index - 1];
    const segment = props.segments[index];
    return (
      !!previous &&
      previous.person === segment.person &&
      segment.at - previous.at <= 300
    );
  };
  return (
    <div
      class="call-transcript relative flex flex-col overflow-hidden rounded border border-edge-muted/50"
      style={{ 'max-height': `${props.maxHeight ?? 600}px` }}
    >
      <div
        ref={scroller}
        class="call-transcript-scroll min-h-0 flex-1 overflow-y-auto"
        role="list"
        aria-label="Transcript"
        onWheel={() => setSync(false)}
        onTouchMove={() => setSync(false)}
        onScroll={() => {
          if (performance.now() < ignoreScrollUntil) return;
          updateInView();
        }}
      >
        <div class="flex flex-col p-4 pt-0">
          <For each={props.segments}>
            {(segment, index) => (
              <div ref={(el) => rows.set(segment.id, el)} role="listitem">
                <button
                  type="button"
                  class="call-transcript-row"
                  data-grouped={grouped(index()) ? 'true' : undefined}
                  data-selected={active() === segment.id ? '' : undefined}
                  data-segment={segment.id}
                  aria-pressed={active() === segment.id}
                  aria-label={`Go to ${formatVideoTimestamp(segment.at)}: ${homepagePeople[segment.person].name}`}
                  onClick={() => props.playback.seek(segment.at)}
                >
                  <Show when={!grouped(index())}>
                    <img
                      class="call-transcript-avatar"
                      src={homepagePeople[segment.person].photo}
                      alt=""
                    />
                    <span class="flex min-w-0 items-center gap-1">
                      <span class="truncate text-sm font-medium">
                        {homepagePeople[segment.person].name}
                      </span>
                      <span class="ml-auto shrink-0 text-xs text-ink-muted tabular-nums">
                        {formatVideoTimestamp(segment.at)}
                      </span>
                    </span>
                  </Show>
                  <span class="call-transcript-text">{segment.text}</span>
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={!sync() && !inView() && active()}>
        <div class="call-transcript-sync">
          <button
            type="button"
            data-sync-video
            onClick={() => {
              setSync(true);
              scrollToActive(true);
              setInView(true);
            }}
          >
            <span>Sync to video time</span>
          </button>
        </div>
      </Show>
    </div>
  );
}

/** CallRecordingBody: header, participants, summary, recording, transcript, chat. */
export function CallRecordBody(props: {
  call: SampleCall;
  playback: CallPlayback;
  transcriptHeight?: number;
  scrollRef?: (element: HTMLDivElement) => void;
  transcriptControls?: (controls: TranscriptControls) => void;
  class?: string;
  after?: JSX.Element;
}) {
  return (
    <div
      ref={props.scrollRef}
      class={`dummy-scroll call-record-scroll ${props.class ?? ''}`}
    >
      <div class="call-record-column">
        <div class="flex flex-col gap-10">
          <header>
            <h1 class="text-2xl font-semibold text-balance text-ink">
              {props.call.title}
            </h1>
            <div class="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              <span>{props.call.ended}</span>
              <span class="text-ink-extra-muted">&middot;</span>
              <span>{formatCallDuration(props.call.duration)}</span>
            </div>
          </header>
          <section class="flex flex-col gap-3" data-call-section="participants">
            <h3 class="text-sm font-semibold text-ink">
              Participants
              <span class="ml-1.5 font-normal text-ink-muted tabular-nums">
                {props.call.people.length}
              </span>
            </h3>
            <div class="flex flex-wrap gap-2" role="list">
              <For each={props.call.people}>
                {(person) => (
                  <span
                    role="listitem"
                    class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted/50 py-1 pr-2.5 pl-1 text-sm text-ink"
                  >
                    <img
                      class="size-5 shrink-0 rounded-full object-cover"
                      src={homepagePeople[person].photo}
                      alt=""
                    />
                    <span class="max-w-48 truncate">{callEmail(person)}</span>
                  </span>
                )}
              </For>
            </div>
          </section>
          <section class="flex flex-col gap-3" data-call-section="summary">
            <h3 class="text-sm font-semibold text-ink">Summary</h3>
            <div class="call-summary text-sm/6 text-pretty text-ink">
              <DemoMarkdown markdown={props.call.summary} />
            </div>
          </section>
          <section class="flex flex-col gap-3" data-call-section="recording">
            <h3 class="text-sm font-semibold text-ink">Recording</h3>
            <div class="overflow-hidden rounded border border-edge-muted/50">
              <RecordingPlayer call={props.call} playback={props.playback} />
            </div>
          </section>
          <section class="flex flex-col gap-3" data-call-section="transcript">
            <h3 class="text-sm font-semibold text-ink">Transcript</h3>
            <CallTranscriptBox
              segments={props.call.segments}
              playback={props.playback}
              maxHeight={props.transcriptHeight}
              controls={props.transcriptControls}
            />
          </section>
          <Show when={props.call.chat}>
            {(chat) => (
              <section
                class="flex min-w-0 flex-col gap-3"
                aria-label="Call chat"
              >
                <h3 class="text-sm font-semibold text-ink">Call chat</h3>
                <div class="call-chat-history min-w-0 rounded border border-edge-muted/50 py-2">
                  <For each={chat()}>
                    {(message) => (
                      <MessageRow message={message}>
                        <Show when={message.documentId}>
                          <span class="dummy-entity-link">
                            <FileIcon class="size-4 text-note" />
                            Q3 launch plan
                          </span>
                        </Show>
                      </MessageRow>
                    )}
                  </For>
                </div>
              </section>
            )}
          </Show>
          {props.after}
        </div>
      </div>
    </div>
  );
}
