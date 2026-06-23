import { DOCS_BASE } from '@app/constants/docs-links';
import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { useChatInputContext } from '@core/component/AI/context';
import { useEmailLinksStatus } from '@core/email-link';
import { useSettingsState } from '@core/constant/SettingsState';
import {
  createNotificationTriage,
  MAX_TRIAGE_EMAILS,
  type TriageAction,
  type TriagedEmail,
} from '@queries/ai/notificationTriage';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { useNavigate } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { dismissCard, isDismissed } from './home-prefs';

const STATUS: Record<TriageAction, { label: string; accent: boolean }> = {
  reply_now: { label: 'Reply now', accent: true },
  reply_later: { label: 'Reply later', accent: false },
  delegate: { label: 'Delegate', accent: false },
  archive: { label: 'Archive', accent: false },
};

const ROW =
  'group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left transition-colors hover:bg-hover';
const TILE = 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted';

function ChevronRight(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function ArrowUpRight(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
function PlusGlyph(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class={props.class}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function BookGlyph(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19a2 2 0 0 0 2 2h13" />
    </svg>
  );
}
function XGlyph(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Content-forward home body. "Needs you" surfaces the AI-triaged emails as
 * status-pill rows; "Get set up" holds Connect + Learn. Sections sit above the
 * bottom-pinned composer.
 */
export function HomeHub() {
  const input = useChatInputContext();
  const emailEnabled = useEmailLinksStatus();
  const { openSettings } = useSettingsState();
  const navigate = useNavigate();

  const notifications = useUserNotificationsQuery({ limit: 50 });
  const triage = createNotificationTriage();

  const emails = createMemo(() =>
    (notifications.data ?? []).filter(
      (n) => n.notification_metadata.tag === 'new_email'
    )
  );

  let dispatched = false;
  createEffect(() => {
    if (dispatched || !emailEnabled()) return;
    const items = emails();
    if (items.length > 0) {
      dispatched = true;
      triage.mutate(items);
    }
  });

  const results = createMemo(() =>
    (triage.data?.emails ?? []).slice(0, MAX_TRIAGE_EMAILS)
  );
  const triageLoading = () => notifications.isLoading || triage.isPending;

  return (
    <div class="flex w-full flex-col gap-7">
      {/* Needs you */}
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <span class="text-sm text-ink-muted">Needs you</span>
          <Show when={emailEnabled()}>
            <button
              type="button"
              class="text-xs text-ink-extra-muted transition-colors hover:text-ink-muted"
              onClick={() => navigate(LIST_VIEW_PATHS.inbox)}
            >
              Show all
            </button>
          </Show>
        </div>
        <div class="flex flex-col gap-2">
          <Show
            when={emailEnabled()}
            fallback={
              <button
                type="button"
                class={ROW}
                onClick={() => openSettings('Email')}
              >
                <span class="flex w-26 shrink-0 items-center gap-2 text-sm text-accent">
                  <span class="size-1.5 rounded-full bg-accent" />
                  Connect
                </span>
                <span class="flex-1 truncate text-sm font-medium text-ink">
                  Connect your inbox
                </span>
                <span class="truncate text-sm text-ink-muted max-sm:hidden">
                  Macro reads & triages your email in seconds
                </span>
                <ChevronRight class="size-4 shrink-0 text-ink-extra-muted" />
              </button>
            }
          >
            <Switch>
              <Match when={triageLoading()}>
                <For each={[0, 1, 2]}>{() => <TriageSkeleton />}</For>
              </Match>
              <Match when={results().length > 0}>
                <For each={results()}>
                  {(email) => (
                    <TriageRow
                      email={email}
                      onSelect={() => input.setPendingDraft(email.prompt)}
                    />
                  )}
                </For>
              </Match>
              <Match when={true}>
                <div class="rounded-xl border border-edge-muted bg-active px-4 py-3 text-sm text-ink-muted">
                  You're all caught up.
                </div>
              </Match>
            </Switch>
          </Show>
        </div>
      </section>

      {/* Get set up */}
      <Show when={!isDismissed('setup')}>
        <section>
          <div class="mb-2 flex items-center justify-between px-1">
            <span class="text-sm text-ink-muted">Get set up</span>
            <button
              type="button"
              class="rounded-md p-1 text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted"
              aria-label="Dismiss get set up"
              onClick={() => dismissCard('setup')}
            >
              <XGlyph class="size-3.5" />
            </button>
          </div>
          <div class="flex flex-col gap-2">
            <SetupRow
              icon={<PlusGlyph class="size-4" />}
              title="Connect your tools"
              desc="Link Linear, Notion, GitHub & more"
              trailing={<ChevronRight class="size-4 shrink-0 text-ink-extra-muted" />}
              onActivate={() => openSettings('Agent')}
            />
            <SetupRow
              icon={<BookGlyph class="size-4" />}
              title="Learn the basics"
              desc="Mentions, search, shortcuts & more"
              trailing={<ArrowUpRight class="size-4 shrink-0 text-ink-extra-muted" />}
              href={DOCS_BASE}
            />
          </div>
        </section>
      </Show>
    </div>
  );
}

function TriageRow(props: { email: TriagedEmail; onSelect: () => void }) {
  const status = () => STATUS[props.email.action];
  return (
    <button type="button" class={ROW} onClick={props.onSelect}>
      <span
        class={`flex w-26 shrink-0 items-center gap-2 text-sm ${status().accent ? 'text-accent' : 'text-ink-muted'}`}
      >
        <span
          class={`size-1.5 rounded-full ${status().accent ? 'bg-accent' : 'bg-ink-muted'}`}
        />
        {status().label}
      </span>
      <span class="max-w-[44%] shrink-0 truncate text-sm font-medium text-ink max-sm:max-w-none">
        {props.email.subject}
      </span>
      <span class="flex-1 truncate text-sm text-ink-muted max-sm:hidden">
        {props.email.sender} · {props.email.reason}
      </span>
      <ChevronRight class="size-4 shrink-0 text-ink-extra-muted" />
    </button>
  );
}

function TriageSkeleton() {
  return (
    <div class="flex items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3" aria-hidden="true">
      <span class="h-3 w-20 shrink-0 animate-pulse rounded bg-hover" />
      <span class="h-3 w-40 shrink-0 animate-pulse rounded bg-hover" />
      <span class="h-3 flex-1 animate-pulse rounded bg-hover" />
    </div>
  );
}

function SetupRow(props: {
  icon: JSX.Element;
  title: string;
  desc: string;
  trailing: JSX.Element;
  onActivate?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span class={TILE}>{props.icon}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-ink">{props.title}</div>
        <div class="text-xs text-ink-muted">{props.desc}</div>
      </div>
      {props.trailing}
    </>
  );
  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" class={ROW} onClick={props.onActivate}>
          {inner}
        </button>
      }
    >
      <a class={ROW} href={props.href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    </Show>
  );
}
