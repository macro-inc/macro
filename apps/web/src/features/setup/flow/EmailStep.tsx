import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import GmailIcon from '@icon/mcp-gmail.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import { cn, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { StatusDot } from '../../settings/integration-ui';
import { ContinueButton, SkipButton } from './shared';

/** How often the step re-checks for freshly-linked inboxes while visible. */
const LINKS_POLL_MS = 5_000;

/** The inbox count at the moment a connect was started — the web OAuth
 * round-trip reloads the page, so detecting "a link landed" after the
 * return needs a pre-redirect baseline that survives the reload. */
const CONNECT_BASELINE_KEY = 'onboarding-flow-email-baseline';

/** Connect Google accounts. On web the add-inbox flow is a full-page OAuth
 * redirect; the flow's persisted step brings the user back here. */
export function EmailStep(props: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  const startAddInbox = useAddInboxFlow();
  const analytics = useAnalytics();
  const [connecting, setConnecting] = createSignal<string>();

  // The links query has a long stale time; a connect that just completed
  // (this tab or another) must show up the moment the user is back.
  onMount(() => {
    void invalidateEmailLinks();
    const interval = setInterval(
      () => void invalidateEmailLinks(),
      LINKS_POLL_MS
    );
    onCleanup(() => clearInterval(interval));
  });

  // No macro_id ownership filter: linking a mailbox owned by another Macro
  // user creates a SHARED link carrying the owner's macro_id — filtering
  // would hide an inbox the user just connected.
  const links = createMemo(() => {
    const uid = userId();
    return [...(linksQuery.data?.links ?? [])].sort(
      (a, b) =>
        Number(b.is_primary && b.macro_id === uid) -
        Number(a.is_primary && a.macro_id === uid)
    );
  });

  // Connecting more than two accounts is a premium feature, and the plan
  // step hasn't happened yet — past two, stop offering connect slots.
  const connectSlots = createMemo(() => {
    const connected = links().length;
    if (connected >= 2) return [];
    return connected === 0
      ? ['Connect primary account', 'Connect secondary account']
      : ['Connect another email'];
  });

  // Detects a landed link via the persisted pre-redirect baseline (the
  // OAuth round-trip reloads the page, so in-memory state won't survive).
  createEffect(() => {
    const count = linksQuery.data?.links.length;
    if (count === undefined) return;
    const raw = sessionStorage.getItem(CONNECT_BASELINE_KEY);
    if (raw === null) return;
    const baseline = Number(raw);
    if (Number.isFinite(baseline) && count > baseline) {
      analytics.track('onboarding_v4_email_connected', {
        connected_count: count,
      });
    }
    if (count !== baseline) sessionStorage.removeItem(CONNECT_BASELINE_KEY);
  });

  const connect = async (slot: string) => {
    if (connecting() !== undefined) return;
    setConnecting(slot);
    analytics.track('onboarding_v4_email_connect_clicked', { slot });
    sessionStorage.setItem(
      CONNECT_BASELINE_KEY,
      String(linksQuery.data?.links.length ?? 0)
    );
    try {
      await startAddInbox();
    } finally {
      setConnecting(undefined);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-2">
        <For each={links()}>
          {(link) => (
            <Layer depth={2}>
              <div class="flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm">
                <Show
                  when={typeof link.photo_url === 'string' && link.photo_url}
                  fallback={<GmailIcon class="size-4 shrink-0" />}
                >
                  {(photoUrl) => (
                    <img
                      src={photoUrl()}
                      alt=""
                      class="size-5 shrink-0 rounded-full"
                    />
                  )}
                </Show>
                <span class="min-w-0 truncate font-medium text-ink">
                  {link.email_address}
                </span>
                <span class="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                  <StatusDot state="connected" />
                  Connected
                </span>
              </div>
            </Layer>
          )}
        </For>

        <For each={connectSlots()}>
          {(slot) => (
            <Layer depth={2}>
              <button
                type="button"
                disabled={connecting() !== undefined}
                onClick={() => void connect(slot)}
                class={cn(
                  'group flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm',
                  'cursor-default outline-none focus-visible:ring-1 focus-visible:ring-ink/30',
                  connecting() === undefined && 'hover:border-ink/10'
                )}
              >
                <GmailIcon class="size-4 shrink-0" />
                <span class="min-w-0 truncate font-medium text-ink">
                  {slot}
                </span>
                <span class="ml-auto shrink-0">
                  <Show
                    when={connecting() === slot}
                    fallback={
                      <span class="flex items-center gap-1 text-xs font-medium text-ink-muted group-hover:text-ink">
                        Connect
                        <ArrowUpRightIcon class="size-3 shrink-0" />
                      </span>
                    }
                  >
                    <span class="flex items-center gap-1.5 text-xs text-ink-muted">
                      <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                      Connecting…
                    </span>
                  </Show>
                </span>
              </button>
            </Layer>
          )}
        </For>
      </div>

      <Show when={links().length === 1}>
        <p class="text-xs leading-snug text-ink-muted">
          Macro works best with two accounts connected — add your secondary
          account so nothing lives in a silo.
        </p>
      </Show>

      <Show
        when={links().length > 0}
        fallback={<SkipButton onClick={props.onSkip} />}
      >
        <ContinueButton onClick={props.onContinue} />
      </Show>
    </div>
  );
}
