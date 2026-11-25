import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ChecksIcon from '@icon/system/regular/checks.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import type { FocusItem, FocusReason } from '../core/focus-triage';
import { SidebarRow, type SidebarRowBadge } from './SidebarRow';

function formatFocusBadge(
  reason: FocusReason | undefined
): SidebarRowBadge | undefined {
  if (!reason) return undefined;
  switch (reason.kind) {
    case 'urgent':
      return { label: t('channelSidebar.focusUrgentTag'), tone: 'warning' };
    case 'needs_reply':
      return { label: t('channelSidebar.focusNeedsReplyTag'), tone: 'warning' };
    case 'mentioned':
      return { label: t('channelSidebar.focusMentionedTag'), tone: 'accent' };
    case 'waiting':
      return {
        label: t('channelSidebar.focusWaitingTag', { age: reason.age }),
        tone: 'warning',
      };
    case 'agent':
      return { label: t('channelSidebar.focusAgentTag'), tone: 'neutral' };
    case 'fyi':
      return { label: t('channelSidebar.focusFyiTag'), tone: 'muted' };
  }
}

function FocusBucketList(props: {
  title: string;
  items: readonly FocusItem[];
  focusedKey?: string;
  headerAction?: { label: string; onClick: () => void };
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="flex flex-col gap-0.5" aria-label={props.title}>
        <div class="flex items-center justify-between px-2 pt-2 pb-1">
          <span class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
            <span>{props.title}</span>
            <span class="tabular-nums text-ink-extra-muted">
              {props.items.length}
            </span>
          </span>
          <Show when={props.headerAction}>
            {(action) => (
              <button
                type="button"
                class="text-[11px] font-medium text-accent hover:underline"
                onClick={action().onClick}
              >
                {action().label}
              </button>
            )}
          </Show>
        </div>
        <For each={props.items}>
          {(item) => (
            <SidebarRow
              channel={item.channel}
              displayName={item.displayName}
              rowId={`focus:${item.channel.id}`}
              focused={props.focusedKey === `focus:${item.channel.id}`}
              density="card"
              badge={formatFocusBadge(item.reason)}
              previewText={item.previewText}
              ageLabel={item.ageLabel}
              urgent={item.reason?.kind === 'urgent'}
            />
          )}
        </For>
      </section>
    </Show>
  );
}

export function FocusView(props: { focusedKey?: string }) {
  const ws = useSidebarWorkspace();
  const model = () => ws.focusModel();
  const engineStatus = () => ws.triage.engineStatus();

  const engineLabel = () => {
    const status = engineStatus();
    if (status === 'jev') return t('channelSidebar.jevEngineActive');
    if (status === 'paused') return t('channelSidebar.jevEnginePaused');
    return t('channelSidebar.jevEngineHeuristic');
  };

  const unreadIdsInFocus = () => {
    const m = model();
    return [...m.direct, ...m.support, ...m.unread, ...m.fyi]
      .filter((item) => item.unread || item.mentions > 0)
      .map((item) => item.channel.id);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-sidebar-lens-panel="focus">
      {/* Calm triage bar */}
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-2.5 py-1.5">
        <Tooltip
          label={`${t('channelSidebar.jevTriageToggle')}: ${engineLabel()} (${ws.triage.stats().estimatedCostFormatted})`}
        >
          <span
            data-triage-engine={engineStatus()}
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-muted"
          >
            <SparkleIcon class="size-2.5 text-accent" />
            {engineLabel()}
          </span>
        </Tooltip>

        <Show when={unreadIdsInFocus().length > 0}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-6 shrink-0 gap-1 px-1.5 text-xs text-ink-muted hover:text-ink"
            onClick={() =>
              fireAndForget(
                ws.markChannelsRead(unreadIdsInFocus()),
                'channels-view'
              )
            }
          >
            <ChecksIcon class="size-3.5" />
            <span>{t('channelSidebar.focusSweepRead')}</span>
          </Button>
        </Show>
      </div>

      {/* Scrollable buckets */}
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <Show
          when={model().totalCount > 0}
          fallback={
            <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <CheckCircleIcon class="size-8 text-success/80" />
              <p class="text-sm font-semibold text-ink">
                {t('channelSidebar.focusAllClearTitle')}
              </p>
              <p class="max-w-52 text-xs leading-5 text-ink-muted">
                {t('channelSidebar.focusAllClearDescription')}
              </p>
            </div>
          }
        >
          <FocusBucketList
            title={t('channelSidebar.focusBucketDirect')}
            items={model().direct}
            focusedKey={props.focusedKey}
          />

          <FocusBucketList
            title={t('channelSidebar.focusBucketSupport')}
            items={model().support}
            focusedKey={props.focusedKey}
            headerAction={
              ws.supportDesk().items.length > 0
                ? {
                    label: t('channelSidebar.openSupportDesk'),
                    onClick: () => ws.prefs.setActiveLens('support'),
                  }
                : undefined
            }
          />

          <FocusBucketList
            title={t('channelSidebar.focusBucketUnread')}
            items={model().unread}
            focusedKey={props.focusedKey}
          />

          {/* Automated & FYI bucket — collapsed by default so noise stays calm */}
          <Show when={model().fyi.length > 0}>
            <section
              class="mt-1 flex flex-col gap-0.5 border-t border-edge-muted pt-1.5"
              aria-label={t('channelSidebar.focusBucketFyi')}
            >
              <button
                type="button"
                data-toggle-fyi-bucket=""
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase hover:bg-hover hover:text-ink-muted"
                onClick={() => ws.prefs.toggleFocusFyi()}
              >
                <Show
                  when={!ws.prefs.prefs.collapsedFocusFyi}
                  fallback={<CaretRightIcon class="size-3 shrink-0" />}
                >
                  <CaretDownIcon class="size-3 shrink-0" />
                </Show>
                <span class="flex-1 truncate">
                  {t('channelSidebar.focusBucketFyi')}
                </span>
                <span class="tabular-nums">{model().fyi.length}</span>
              </button>
              <Show when={!ws.prefs.prefs.collapsedFocusFyi}>
                <For each={model().fyi}>
                  {(item) => (
                    <SidebarRow
                      channel={item.channel}
                      displayName={item.displayName}
                      rowId={`focus:${item.channel.id}`}
                      focused={props.focusedKey === `focus:${item.channel.id}`}
                      density="card"
                      badge={formatFocusBadge(item.reason)}
                      previewText={item.previewText}
                      ageLabel={item.ageLabel}
                    />
                  )}
                </For>
              </Show>
            </section>
          </Show>
        </Show>
      </div>
    </div>
  );
}
