import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { useChatInputContext } from '@core/component/AI/context';
import { useEmailLinksStatus } from '@core/email-link';
import {
  createNotificationTriage,
  MAX_TRIAGE_EMAILS,
  type TriageAction,
  type TriagedEmail,
} from '@queries/ai/notificationTriage';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { useNavigate } from '@solidjs/router';
import { createEffect, createMemo, For, Match, Show, Switch } from 'solid-js';

const ACTION_META: Record<TriageAction, { label: string; dot: string }> = {
  reply_now: { label: 'Reply now', dot: 'bg-accent' },
  reply_later: { label: 'Reply later', dot: 'bg-ink-muted' },
  delegate: { label: 'Delegate', dot: 'bg-ink-muted' },
  archive: { label: 'Archive', dot: 'bg-ink-extra-muted' },
};

/**
 * Experiment: triage the user's most important emails with a fast model and let
 * a click drop a concrete next-action into the composer. Only mounts when the
 * user has a connected inbox.
 */
export function NotificationTriageExperiment() {
  const emailEnabled = useEmailLinksStatus();
  return (
    <Show when={emailEnabled()}>
      <TriagePanel />
    </Show>
  );
}

function TriagePanel() {
  const navigate = useNavigate();
  const input = useChatInputContext();
  const notifications = useUserNotificationsQuery({ limit: 50 });
  const triage = createNotificationTriage();

  // Only emails — keeps the prompt tiny (fast) and on-topic.
  const emails = createMemo(() =>
    (notifications.data ?? []).filter(
      (n) => n.notification_metadata.tag === 'new_email'
    )
  );

  // Dispatch immediately, once, as soon as the emails are available.
  let dispatched = false;
  createEffect(() => {
    if (dispatched) return;
    const items = emails();
    if (items.length > 0) {
      dispatched = true;
      triage.mutate(items);
    }
  });

  const results = createMemo(() =>
    (triage.data?.emails ?? []).slice(0, MAX_TRIAGE_EMAILS)
  );
  const loading = () => notifications.isLoading || triage.isPending;
  const hasEmails = () => notifications.isLoading || emails().length > 0;

  return (
    <Show when={hasEmails()}>
      <div class="group/stack mx-auto w-full max-w-3xl">
        <div class="mb-2.5 flex items-center justify-between px-1">
          <span class="text-sm text-ink-muted">Suggested triage</span>
          <Show
            when={loading()}
            fallback={
              <button
                type="button"
                class="text-sm text-ink-muted transition-colors hover:text-ink"
                onClick={() => navigate(LIST_VIEW_PATHS.inbox)}
              >
                Go to inbox
              </button>
            }
          >
            <span class="text-sm text-ink-extra-muted">Analyzing…</span>
          </Show>
        </div>

        <Switch>
          <Match when={triage.isError}>
            <p class="px-1 text-sm text-failure-ink">
              {triage.error?.message ?? 'Could not triage right now.'}
            </p>
          </Match>
          <Match when={loading()}>
            <TriageSkeleton />
          </Match>
          <Match when={results().length > 0}>
            <div role="list" class="isolate flex flex-col gap-2.5">
              <For each={results()}>
                {(email, i) => (
                  <TriageRow
                    email={email}
                    stackClass={stackClass(i())}
                    onSelect={() => input.setPendingDraft(email.prompt)}
                  />
                )}
              </For>
            </div>
          </Match>
          <Match when={results().length === 0}>
            <p class="px-1 text-sm text-ink-muted">
              Nothing needs your attention right now.
            </p>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

// Cards keep their real (spread) positions in flow, so the section always
// reserves the full expanded height — hovering never reflows content above it.
// Collapsed, each lower card is pulled UP via transform into a deck behind the
// top card; on hover/focus it slides back DOWN into its reserved slot.
// Translate amounts ≈ each card's flow offset (h-16 row + gap-2.5) minus a small
// peek, so the deck cascades downward.
const STACK_EXPAND =
  'group-hover/stack:translate-y-0 group-hover/stack:scale-100 group-hover/stack:opacity-100 group-focus-within/stack:translate-y-0 group-focus-within/stack:scale-100 group-focus-within/stack:opacity-100';

function stackClass(index: number): string {
  switch (index) {
    case 0:
      return 'z-30';
    case 1:
      return `z-20 -translate-y-16 scale-[0.97] opacity-90 ${STACK_EXPAND}`;
    default:
      return `z-10 -translate-y-32 scale-[0.94] opacity-80 ${STACK_EXPAND}`;
  }
}

function TriageRow(props: {
  email: TriagedEmail;
  stackClass: string;
  onSelect: () => void;
}) {
  const meta = () => ACTION_META[props.email.action];
  return (
    <button
      type="button"
      role="listitem"
      class={`group flex h-16 w-full origin-top items-center gap-3 rounded-xl border border-edge-muted bg-active px-3 text-left transition-all duration-200 ease-out hover:bg-hover ${props.stackClass}`}
      onClick={props.onSelect}
    >
      <span class={`size-1.5 shrink-0 rounded-full ${meta().dot}`} aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-ink">
          {props.email.subject}
        </div>
        <div class="truncate text-xs text-ink-muted">
          {props.email.sender} · {props.email.reason}
        </div>
      </div>
      <div class="shrink-0 text-xs text-ink-muted group-hover:text-ink">
        {meta().label}
      </div>
    </button>
  );
}

function TriageSkeleton() {
  return (
    <div class="isolate flex flex-col gap-2.5" aria-hidden="true">
      <For each={[0, 1, 2]}>
        {(_, i) => (
          <div
            class={`flex h-16 origin-top items-center gap-3 rounded-xl border border-edge-muted bg-active px-3 transition-all duration-200 ease-out ${stackClass(i())}`}
          >
            <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-hover" />
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div class="h-3 w-2/5 animate-pulse rounded bg-hover" />
              <div class="h-2.5 w-3/5 animate-pulse rounded bg-hover" />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
