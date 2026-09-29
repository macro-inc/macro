import type { BackgroundEffect } from '@core/media/background-effect';
import ArrowLeft from '@phosphor/arrow-left.svg';
import Phone from '@phosphor/phone-call.svg';
import { Button } from '@ui';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { MeetingCallHeading } from '../components/meeting-call-heading';
import { MeetingCopyButton } from '../components/meeting-copy-button';
import {
  MeetingParticipants,
  type MeetingParticipantsState,
} from '../components/meeting-participants';
import type {
  MeetingPageState,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import {
  createMeetingMedia,
  type MeetingMediaAccess,
} from '../primitives/meeting-media';
import { createMeetingSession } from '../primitives/meeting-session';
import { MeetingMediaSetup } from './meeting-media-setup';

export function MeetingPage(props: {
  source: Accessor<MeetingPageState>;
  session: MeetingSessionCapabilities;
  mediaAccess?: MeetingMediaAccess;
  initialBackground?: BackgroundEffect;
  readBackgroundImage?: (file: File) => Promise<string>;
  authenticated: Accessor<boolean | undefined>;
  author: Accessor<string>;
  avatar?: JSX.Element;
  participants?: MeetingParticipantsState;
  startCall?: boolean;
  url?: string;
  onCopy: () => Promise<void>;
  onRename?: (title: string) => Promise<void>;
  /** The host keeps the URL in sync without replacing this session owner. */
  onCallStateChange?: (connected: boolean) => void;
  /** Explicit hangup, distinct from losing the connection or cancelling setup. */
  onLeave?: () => void;
  /** Supplied only for the creator's New Call setup flow. */
  renderInvite?: (joining: Accessor<boolean>) => JSX.Element;
  /** Login redirect for channel-linked calls, which are members-only. */
  onSignIn?: () => void;
  renderCall: (onLeave: () => void, name: Accessor<string>) => JSX.Element;
}) {
  const session = createMeetingSession(props.session);
  const [name, setName] = createSignal('');
  const [leaving, setLeaving] = createSignal(false);
  const media = createMeetingMedia(props.mediaAccess, props.initialBackground);
  const [uploadingBackground, setUploadingBackground] = createSignal(false);
  const ready = () => {
    const state = props.source();
    return state.kind === 'ready' ? state : undefined;
  };
  /** Guests cannot join channel-linked meetings; they must sign in first. */
  const membersOnly = () =>
    ready()?.channelId != null && props.authenticated() !== true;
  const displayName = () =>
    props.authenticated() ? props.author() : name().trim();
  const inCall = () =>
    session.joinedCallId() !== undefined &&
    props.session.activeCallId() === session.joinedCallId() &&
    props.session.isInCall();

  createEffect(on(inCall, (connected) => props.onCallStateChange?.(connected)));

  createEffect(
    on(
      () =>
        Boolean(ready()) &&
        !membersOnly() &&
        !inCall() &&
        !session.joining() &&
        !leaving(),
      (setup) => {
        if (setup) void media.prepare();
        else media.release();
      }
    )
  );
  const join = () => {
    if (membersOnly() || leaving() || media.pending() || uploadingBackground())
      return;
    // The call publishes the preview tracks rather than re-opening the
    // devices, so the waiting room is the only place permission is asked.
    return session.join(props.authenticated() ? undefined : name(), {
      microphoneEnabled: media.microphoneEnabled(),
      cameraEnabled: media.cameraEnabled(),
      microphoneDeviceId: media.selectedDevices().microphone,
      cameraDeviceId: media.selectedDevices().camera,
      speakerDeviceId: media.selectedDevices().speaker,
      backgroundEffect: media.backgroundEffect(),
      localTracks: media.handoff(),
    });
  };
  const leave = () => {
    batch(() => {
      setLeaving(true);
      void session.leave();
      props.onLeave?.();
    });
  };

  return (
    <main class="ph-no-capture flex h-dvh min-h-0 flex-col bg-surface p-4 text-ink sm:p-6">
      <header class="flex flex-wrap items-center gap-4 pb-4">
        <Show when={!inCall()}>
          <a
            href="/app"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ArrowLeft class="size-4" />
            Back to Macro
          </a>
        </Show>
        <Show
          when={inCall()}
          fallback={
            <div class="flex items-center gap-3">
              <Phone class="size-6 text-accent" />
              <div>
                <p class="text-xs font-medium text-ink-muted">Macro Calls</p>
                <h1 class="text-lg font-semibold">
                  {ready()?.title || 'Call'}
                </h1>
              </div>
            </div>
          }
        >
          <MeetingCallHeading
            title={ready()?.title || 'Call'}
            onRename={props.onRename}
          />
          <Show when={props.url}>
            {(url) => <MeetingCopyButton url={url()} onCopy={props.onCopy} />}
          </Show>
        </Show>
      </header>
      <Switch>
        <Match when={leaving()}>
          <div
            class="flex flex-1 items-center justify-center text-ink-muted"
            role="status"
          >
            Leaving call…
          </div>
        </Match>
        <Match when={inCall()}>
          <div class="min-h-0 flex-1">
            {props.renderCall(leave, displayName)}
          </div>
        </Match>
        <Match when={props.source().kind === 'loading'}>
          <div
            class="flex flex-1 items-center justify-center text-ink-muted"
            role="status"
          >
            Loading call…
          </div>
        </Match>
        <Match when={props.source().kind === 'unavailable'}>
          <div class="m-auto max-w-md text-center">
            <h2 class="text-2xl font-semibold">This call is unavailable</h2>
            <p class="mt-3 text-ink-muted">
              The link may have expired or the call may have been canceled. Ask
              the organizer for a new link.
            </p>
          </div>
        </Match>
        <Match when={membersOnly()}>
          <div class="m-auto max-w-md text-center">
            <h2 class="text-2xl font-semibold">{ready()?.title || 'Call'}</h2>
            <p class="mt-3 text-ink-muted">
              This call is for Macro members. Sign in to join.
            </p>
            <Button
              variant="ghost"
              size="lg"
              class="mt-6 bg-hover text-ink not-touch:not-disabled:hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => props.onSignIn?.()}
            >
              Sign in
            </Button>
          </div>
        </Match>
        <Match when={ready()}>
          <div class="m-auto grid w-full max-w-6xl gap-8 py-6 md:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] md:items-center">
            <MeetingMediaSetup
              media={media}
              name={displayName()}
              avatar={props.avatar}
              disabled={session.joining()}
              readBackgroundImage={props.readBackgroundImage}
              onUploading={setUploadingBackground}
            />
            <form
              class="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void join();
              }}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-2xl font-semibold">
                    {session.hasLeft()
                      ? 'You left the call'
                      : props.startCall
                        ? 'Ready to start?'
                        : 'Ready to join?'}
                  </h2>
                  <Show when={ready()?.scheduledStart}>
                    {(start) => (
                      <p class="mt-2 text-sm text-ink-muted">
                        {new Date(start()).toLocaleString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </Show>
                </div>
              </div>
              <Show when={props.participants}>
                {(state) => <MeetingParticipants state={state()} />}
              </Show>
              <Show
                when={!props.authenticated()}
                fallback={
                  <p class="text-sm text-ink-muted">
                    Joining as {props.author()}
                  </p>
                }
              >
                <label class="flex flex-col gap-2 text-sm font-medium">
                  Your name
                  <input
                    class="rounded-lg border border-edge-muted bg-input px-3 py-2.5 text-ink placeholder:text-ink-placeholder outline-none focus:border-accent"
                    placeholder="Enter your name"
                    autocomplete="name"
                    value={name()}
                    maxLength={80}
                    required
                    disabled={session.joining()}
                    onInput={(event) => setName(event.currentTarget.value)}
                  />
                </label>
              </Show>
              <Show when={session.error()}>
                <p role="alert" class="text-sm text-failure">
                  {session.error()}
                </p>
              </Show>
              <Show when={session.joinedCallId() && !props.session.isInCall()}>
                <p role="status" class="text-sm text-ink-muted">
                  You were disconnected. Join again to reconnect.
                </p>
              </Show>
              <Show when={props.authenticated() === true && !session.hasLeft()}>
                {props.renderInvite?.(session.joining)}
              </Show>
              <Button
                variant="ghost"
                size="lg"
                class="w-full bg-hover text-ink not-touch:not-disabled:hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
                type="submit"
                disabled={
                  session.joining() ||
                  media.pending() ||
                  uploadingBackground() ||
                  (!props.authenticated() && !name().trim())
                }
              >
                <Phone class="size-5" />
                {session.joining()
                  ? props.startCall
                    ? 'Starting…'
                    : 'Joining…'
                  : session.hasLeft()
                    ? 'Rejoin call'
                    : props.startCall
                      ? 'Start call'
                      : 'Join call'}
              </Button>
              <p class="text-xs text-ink-muted">
                Calls are recorded and transcribed for the organizer and Macro
                participants.
              </p>
            </form>
          </div>
        </Match>
      </Switch>
    </main>
  );
}
