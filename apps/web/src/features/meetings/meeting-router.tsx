import { getActiveMeetingPath, getMeetingPath } from '@channel/Call/call-link';
import { useLocation, useNavigate } from '@solidjs/router';
import { createMemo, Match, Show, Suspense, Switch } from 'solid-js';
import { parseMeetingRoute } from './core/meeting-navigation';
import { MeetingRouteContent } from './meeting-route';
import { NewMeetingRoute } from './new-meeting-route';
import { createMeetingNavigation } from './primitives/meeting-navigation';
import { useQuickCallsFlag } from './use-quick-calls-flag';

export function MeetingRouter() {
  const flag = useQuickCallsFlag();
  return (
    <Show
      when={!flag().loading}
      fallback={<div class="p-6 text-ink-muted">Loading call…</div>}
    >
      <Show
        when={flag().enabled}
        fallback={
          <div class="p-6 text-ink-muted">This call is unavailable</div>
        }
      >
        <EnabledMeetingRouter />
      </Show>
    </Show>
  );
}

/** One matched route keeps media/session ownership alive as its phase changes. */
function EnabledMeetingRouter() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = createMeetingNavigation({
    target: createMemo(() => parseMeetingRoute(location.pathname)),
    replace: (target) =>
      navigate(
        target.kind === 'active'
          ? getActiveMeetingPath(target.shareToken)
          : getMeetingPath(target.shareToken),
        { replace: true }
      ),
    returnToApp: () => navigate('/', { replace: true }),
  });
  return (
    <Suspense fallback={<div class="p-6 text-ink-muted">Loading call…</div>}>
      <Show when={navigation.entry()} keyed>
        {(entry) => (
          <Switch>
            <Match when={entry.kind === 'new'}>
              <NewMeetingRoute
                onLeave={() => navigation.leave(entry)}
                onCallStateChange={(connected, shareToken) =>
                  navigation.setCallState(entry, connected, shareToken)
                }
              />
            </Match>
            <Match when={entry.kind === 'existing' ? entry : undefined}>
              {(existing) => (
                <MeetingRouteContent
                  onLeave={() => navigation.leave(entry)}
                  shareToken={existing().shareToken}
                  onCallStateChange={(connected) =>
                    navigation.setCallState(
                      entry,
                      connected,
                      existing().shareToken
                    )
                  }
                />
              )}
            </Match>
            <Match when={entry.kind === 'unavailable'}>
              <div class="p-6 text-ink-muted">This call is unavailable</div>
            </Match>
          </Switch>
        )}
      </Show>
    </Suspense>
  );
}
