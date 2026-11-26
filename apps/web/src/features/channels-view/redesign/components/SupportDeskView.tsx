import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { cn, Input } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import type {
  SupportChannelState,
  SupportSenderRole,
} from '../core/sidebar-model';
import type { SupportTriageItem } from '../core/support-triage';
import { SidebarRow, type SidebarRowBadge } from './SidebarRow';

function supportBadge(item: SupportTriageItem): SidebarRowBadge {
  switch (item.state) {
    case 'urgent':
      return { label: t('channelSidebar.supportStateUrgent'), tone: 'warning' };
    case 'needs_reply':
      return {
        label: t('channelSidebar.supportStateNeedsReply'),
        tone: 'warning',
      };
    case 'agent_handling':
      return { label: t('channelSidebar.supportStateAgent'), tone: 'accent' };
    case 'waiting_on_customer':
      return {
        label: t('channelSidebar.supportStateWaiting'),
        tone: 'neutral',
      };
    case 'resolved':
      return { label: t('channelSidebar.supportStateResolved'), tone: 'muted' };
  }
}

function senderPrefix(role: SupportSenderRole): string | undefined {
  switch (role) {
    case 'you':
      return t('channelSidebar.supportSenderYou');
    case 'teammate':
      return t('channelSidebar.supportSenderTeam');
    case 'agent':
      return t('channelSidebar.supportSenderAgent');
    case 'customer':
      return t('channelSidebar.supportSenderCustomer');
    default:
      return undefined;
  }
}

const SUPPORT_BUCKET_PAGE_SIZE = 25;

function SupportBucket(props: {
  bucketKey: SupportChannelState;
  title: string;
  items: readonly SupportTriageItem[];
  collapsed: boolean;
  onToggle: () => void;
  tone?: 'warning' | 'accent' | 'neutral' | 'muted';
  focusedKey?: string;
}) {
  const [limit, setLimit] = createSignal(SUPPORT_BUCKET_PAGE_SIZE);
  const visibleItems = () => props.items.slice(0, limit());
  const overflow = () => Math.max(0, props.items.length - limit());

  return (
    <Show when={props.items.length > 0}>
      <section
        class="flex flex-col gap-0.5"
        data-support-bucket={props.bucketKey}
        aria-label={props.title}
      >
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide uppercase hover:bg-hover"
          onClick={props.onToggle}
        >
          <Show
            when={!props.collapsed}
            fallback={
              <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
            }
          >
            <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
          </Show>
          <span
            class={cn(
              'flex-1 truncate',
              props.tone === 'warning'
                ? 'text-warning'
                : props.tone === 'accent'
                  ? 'text-accent'
                  : 'text-ink-muted'
            )}
          >
            {props.title}
          </span>
          <span
            class={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
              props.tone === 'warning'
                ? 'bg-warning/15 text-warning'
                : 'bg-surface-2 text-ink-muted'
            )}
          >
            {props.items.length}
          </span>
        </button>

        <Show when={!props.collapsed}>
          <div class="flex flex-col gap-0.5">
            <For each={visibleItems()}>
              {(item) => (
                <SidebarRow
                  channel={item.channel}
                  displayName={item.displayName}
                  rowId={`support:${item.channel.id}`}
                  focused={props.focusedKey === `support:${item.channel.id}`}
                  density="card"
                  badge={supportBadge(item)}
                  previewText={item.previewText}
                  senderPrefix={senderPrefix(item.senderRole)}
                  ageLabel={item.waitAgeLabel}
                  urgent={item.state === 'urgent'}
                />
              )}
            </For>
            <Show when={overflow() > 0}>
              <button
                type="button"
                data-support-bucket-more={props.bucketKey}
                class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
                onClick={() =>
                  setLimit((current) => current + SUPPORT_BUCKET_PAGE_SIZE)
                }
              >
                <span>
                  {t('channelSidebar.sectionShowMore', { count: overflow() })}
                </span>
              </button>
            </Show>
          </div>
        </Show>
      </section>
    </Show>
  );
}

export function SupportDeskView(props: { focusedKey?: string }) {
  const ws = useSidebarWorkspace();
  const [query, setQuery] = createSignal('');
  const desk = () => ws.supportDesk();

  const normalizedQuery = () => query().trim().toLowerCase();

  const filterItems = (items: readonly SupportTriageItem[]) => {
    const q = normalizedQuery();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.displayName.toLowerCase().includes(q) ||
        item.channel.name.toLowerCase().includes(q) ||
        item.previewText.toLowerCase().includes(q)
    );
  };

  const needsReply = createMemo(() => filterItems(desk().needsReplyGroup));
  const agentHandling = createMemo(() =>
    filterItems(desk().byState.agent_handling)
  );
  const waitingCustomer = createMemo(() =>
    filterItems(desk().byState.waiting_on_customer)
  );
  const resolved = createMemo(() => filterItems(desk().byState.resolved));

  const totalVisible = () =>
    needsReply().length +
    agentHandling().length +
    waitingCustomer().length +
    resolved().length;

  const isBucketCollapsed = (state: SupportChannelState) =>
    normalizedQuery().length === 0 &&
    ws.prefs.prefs.collapsedSupportBuckets.includes(state);

  const engineLabel = () => {
    const status = ws.triage.engineStatus();
    if (status === 'jev') return t('channelSidebar.jevEngineActive');
    if (status === 'paused') return t('channelSidebar.jevEnginePaused');
    return t('channelSidebar.jevEngineHeuristic');
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-sidebar-lens-panel="support">
      {/* Operational summary + customer filter */}
      <div class="flex shrink-0 flex-col gap-2 border-b border-edge-muted px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1.5">
            <Show
              when={desk().needsReplyCount > 0}
              fallback={
                <span class="text-xs font-medium text-success">
                  {t('channelSidebar.supportAllHandledTitle')}
                </span>
              }
            >
              <span class="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-warning">
                {t('channelSidebar.supportWaitingSummary', {
                  count: desk().needsReplyCount,
                })}
              </span>
            </Show>
            <Show when={desk().urgentCount > 0}>
              <span class="text-[11px] font-medium tabular-nums text-ink-muted">
                ·{' '}
                {t('channelSidebar.supportUrgentSummary', {
                  count: desk().urgentCount,
                })}
              </span>
            </Show>
          </div>

          <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            <SparkleIcon class="size-2.5 text-accent" />
            {engineLabel()}
          </span>
        </div>

        <div class="relative flex items-center">
          <SearchIcon class="pointer-events-none absolute left-2.5 size-3.5 text-ink-extra-muted" />
          <Input
            type="text"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('channelSidebar.supportFilterPlaceholder')}
            aria-label={t('channelSidebar.supportFilterPlaceholder')}
            class="h-7 w-full pl-7 pr-7 text-xs"
          />
          <Show when={query().length > 0}>
            <button
              type="button"
              aria-label="Clear filter"
              class="absolute right-2 flex size-4 items-center justify-center rounded text-ink-extra-muted hover:text-ink"
              onClick={() => setQuery('')}
            >
              <XIcon class="size-3" />
            </button>
          </Show>
        </div>
      </div>

      {/* Buckets */}
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <Show
          when={totalVisible() > 0}
          fallback={
            <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <CheckCircleIcon class="size-8 text-success/80" />
              <p class="text-sm font-semibold text-ink">
                {normalizedQuery()
                  ? t('channelSidebar.supportEmptySearch', { query: query() })
                  : t('channelSidebar.supportAllHandledTitle')}
              </p>
              <Show when={!normalizedQuery()}>
                <p class="max-w-52 text-xs leading-5 text-ink-muted">
                  {t('channelSidebar.supportAllHandledDescription')}
                </p>
              </Show>
            </div>
          }
        >
          <SupportBucket
            bucketKey="needs_reply"
            title={t('channelSidebar.supportBucketNeedsReply')}
            items={needsReply()}
            collapsed={isBucketCollapsed('needs_reply')}
            onToggle={() => ws.prefs.toggleSupportBucket('needs_reply')}
            tone="warning"
            focusedKey={props.focusedKey}
          />

          <SupportBucket
            bucketKey="agent_handling"
            title={t('channelSidebar.supportBucketAgentHandling')}
            items={agentHandling()}
            collapsed={isBucketCollapsed('agent_handling')}
            onToggle={() => ws.prefs.toggleSupportBucket('agent_handling')}
            tone="accent"
            focusedKey={props.focusedKey}
          />

          <SupportBucket
            bucketKey="waiting_on_customer"
            title={t('channelSidebar.supportBucketWaitingCustomer')}
            items={waitingCustomer()}
            collapsed={isBucketCollapsed('waiting_on_customer')}
            onToggle={() => ws.prefs.toggleSupportBucket('waiting_on_customer')}
            tone="neutral"
            focusedKey={props.focusedKey}
          />

          <SupportBucket
            bucketKey="resolved"
            title={t('channelSidebar.supportBucketResolved')}
            items={resolved()}
            collapsed={isBucketCollapsed('resolved')}
            onToggle={() => ws.prefs.toggleSupportBucket('resolved')}
            tone="muted"
            focusedKey={props.focusedKey}
          />

          <Show when={ws.supportHasMoreWindow?.() && ws.loadMoreSupport}>
            <button
              type="button"
              data-support-load-more-window=""
              class="mt-1 flex h-7 items-center justify-center rounded-md border border-edge-muted px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => ws.loadMoreSupport?.()}
            >
              {t('channelSidebar.sectionShowMore', { count: 25 })}
            </button>
          </Show>
        </Show>
      </div>
    </div>
  );
}
