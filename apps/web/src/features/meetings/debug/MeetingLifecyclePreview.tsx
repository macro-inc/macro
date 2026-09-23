import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { LiveCallsSidebar } from '../components/live-calls-sidebar';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { MeetingPage } from '../views/meeting-page';

/** Real page/session owners with a deferred, entirely simulated leave request. */
export default function MeetingLifecyclePreview() {
  const lifecycle = createMeetingSessionLifecycle();
  const [owner, setOwner] = createSignal<number>();
  const [connected, setConnected] = createSignal(false);
  const [live, setLive] = createSignal(true);
  const [holdCleanup, setHoldCleanup] = createSignal(true);
  const [pendingCleanup, setPendingCleanup] = createSignal(false);
  const [requests, setRequests] = createSignal(0);
  let nextOwner = 0;
  let finishCleanup: (() => void) | undefined;
  onCleanup(() => finishCleanup?.());

  async function release() {
    if (holdCleanup()) {
      setPendingCleanup(true);
      await new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
    }
    // Like the server's identity-based leave, this would remove a replacement
    // connection if its join were allowed to overtake the pending cleanup.
    setConnected(false);
    finishCleanup = undefined;
    setPendingCleanup(false);
  }

  return (
    <div class="h-full overflow-auto bg-surface text-ink">
      <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted p-3 text-xs">
        <span>Simulated call lifecycle · no media or invitations</span>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={holdCleanup()}
            onChange={(event) => setHoldCleanup(event.currentTarget.checked)}
          />
          Hold leave cleanup
        </label>
        <Button
          variant="outline"
          disabled={!pendingCleanup()}
          onClick={() => finishCleanup?.()}
        >
          Finish pending leave
        </Button>
        <span role="status">Join requests: {requests()}</span>
      </div>
      <Show
        when={owner()}
        keyed
        fallback={
          <main class="flex flex-col items-start gap-4 p-6">
            <h1 class="text-xl font-semibold">Macro preview</h1>
            <p class="text-sm text-ink-muted">
              Another teammate stays in this simulated call while you leave and
              rejoin.
            </p>
            <aside class="w-64 rounded-lg border border-edge-muted p-3">
              <LiveCallsSidebar
                calls={
                  live()
                    ? [
                        {
                          id: 'preview-call',
                          label: 'Call with Maya Chen',
                          url: '/app/meet/join/preview-only',
                        },
                      ]
                    : []
                }
                onJoin={() => setOwner(++nextOwner)}
              />
              <Show when={!live()}>
                <p class="text-sm text-ink-muted">Call ended.</p>
              </Show>
            </aside>
            <Button
              variant="outline"
              disabled={!live() || pendingCleanup()}
              onClick={() => setLive(false)}
            >
              End simulated call
            </Button>
          </main>
        }
      >
        {(_owner) => (
          <MeetingPage
            source={() => ({
              kind: 'ready',
              title: 'Call with Maya Chen',
              scheduledStart: null,
              scheduledEnd: null,
              channelId: null,
            })}
            authenticated={() => true}
            author={() => 'Preview teammate'}
            onCopy={async () => {}}
            onLeave={() => setOwner(undefined)}
            mediaAccess={{ request: async () => new MediaStream() }}
            session={{
              lifecycle,
              shareToken: () => 'preview-only',
              isInCall: connected,
              activeCallId: () => (connected() ? 'preview-call' : null),
              join: async () => {
                setRequests((count) => count + 1);
                return {
                  callId: 'preview-call',
                  channelId: null,
                  roomName: 'preview-room',
                  serverUrl: 'wss://example.invalid',
                  token: `preview-${requests()}`,
                  participantId: 'preview-teammate',
                  shareToken: 'preview-only',
                };
              },
              connect: async () => {
                setConnected(true);
              },
              disconnect: async () => {
                setConnected(false);
              },
              release,
            }}
            renderCall={(leave) => (
              <div class="flex flex-col items-start gap-4 p-6">
                <p role="status">Connected with Maya Chen.</p>
                <Button variant="danger" onClick={leave}>
                  Leave call
                </Button>
              </div>
            )}
          />
        )}
      </Show>
    </div>
  );
}
