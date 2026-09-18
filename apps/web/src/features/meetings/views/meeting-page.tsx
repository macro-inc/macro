import Phone from '@phosphor/phone-call.svg';
import { Button, ToggleSwitch } from '@ui';
import {
  type Accessor,
  children,
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
import type {
  MeetingPageState,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { createMeetingSession } from '../primitives/meeting-session';

export function MeetingPage(props: {
  source: Accessor<MeetingPageState>;
  session: MeetingSessionCapabilities;
  authenticated: Accessor<boolean | undefined>;
  author: Accessor<string>;
  avatar?: JSX.Element;
  autoJoin: boolean;
  url: string;
  onCopy: () => Promise<void>;
  onRename?: (title: string) => Promise<void>;
  renderCall: (onLeave: () => void, name: Accessor<string>) => JSX.Element;
}) {
  const avatar = children(() => props.avatar);
  const session = createMeetingSession(props.session);
  const [name, setName] = createSignal('');
  const [microphoneEnabled, setMicrophoneEnabled] = createSignal(true);
  const [cameraEnabled, setCameraEnabled] = createSignal(false);
  const ready = () => {
    const state = props.source();
    return state.kind === 'ready' ? state : undefined;
  };
  const displayName = () =>
    props.authenticated() ? props.author() : name().trim();
  const inCall = () =>
    session.joinedCallId() !== undefined &&
    props.session.activeCallId() === session.joinedCallId() &&
    props.session.isInCall();

  const join = () =>
    session.join(props.authenticated() ? undefined : name(), {
      microphoneEnabled: microphoneEnabled(),
      cameraEnabled: cameraEnabled(),
    });

  // Only an explicit instant-call action opts into auto-joining. Guest links
  // always wait for a name and a deliberate Join click before accessing media.
  let autoJoinStarted = false;
  createEffect(
    on(
      () => [props.authenticated(), ready() !== undefined] as const,
      ([authenticated, loaded]) => {
        if (!props.autoJoin || autoJoinStarted || !authenticated || !loaded)
          return;
        autoJoinStarted = true;
        void join();
      }
    )
  );

  return (
    <main class="ph-no-capture flex h-dvh min-h-0 flex-col bg-surface p-4 text-ink sm:p-6">
      <header class="flex flex-wrap items-center gap-4 pb-4">
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
          <MeetingCopyButton url={props.url} onCopy={props.onCopy} />
        </Show>
      </header>
      <Switch>
        <Match when={inCall()}>
          <div class="min-h-0 flex-1">
            {props.renderCall(() => void session.leave(), displayName)}
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
        <Match when={ready()}>
          <div class="m-auto grid w-full max-w-4xl gap-8 py-6 md:grid-cols-2 md:items-center">
            <div class="flex aspect-video flex-col items-center justify-center gap-5 rounded-2xl border border-edge-muted bg-message px-6">
              <div class="flex size-24 items-center justify-center rounded-full bg-accent/10 text-4xl font-medium text-accent">
                <Show
                  when={avatar()}
                  fallback={
                    displayName().charAt(0).toUpperCase() || (
                      <Phone class="size-10" />
                    )
                  }
                >
                  {avatar()}
                </Show>
              </div>
              <p class="text-center text-sm text-ink-muted">
                Your microphone and camera turn on only after you join.
              </p>
            </div>
            <form
              class="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void join();
              }}
            >
              <div>
                <h2 class="text-2xl font-semibold">
                  {session.hasLeft() ? 'You left the call' : 'Ready to join?'}
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
              <div class="flex flex-wrap items-center gap-6">
                <ToggleSwitch
                  checked={microphoneEnabled()}
                  disabled={session.joining()}
                  onChange={setMicrophoneEnabled}
                  size="sm"
                  label="Microphone"
                  labelClass="whitespace-nowrap text-xs text-ink-muted"
                />
                <ToggleSwitch
                  checked={cameraEnabled()}
                  disabled={session.joining()}
                  onChange={setCameraEnabled}
                  size="sm"
                  label="Camera"
                  labelClass="whitespace-nowrap text-xs text-ink-muted"
                />
              </div>
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
              <Button
                variant="ghost"
                size="lg"
                class="bg-hover text-ink not-touch:not-disabled:hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
                type="submit"
                disabled={
                  session.joining() ||
                  (!props.authenticated() && !name().trim())
                }
              >
                <Phone class="size-5" />
                {session.joining()
                  ? 'Joining…'
                  : session.hasLeft()
                    ? 'Rejoin call'
                    : 'Join call'}
              </Button>
              <Show when={session.joining()}>
                <Button type="button" onClick={() => void session.leave()}>
                  Cancel
                </Button>
              </Show>
              <p class="text-xs text-ink-muted">
                Calls are recorded and transcribed for the organizer and Macro
                participants.
              </p>
              <MeetingCopyButton url={props.url} onCopy={props.onCopy} />
            </form>
          </div>
        </Match>
      </Switch>
    </main>
  );
}
