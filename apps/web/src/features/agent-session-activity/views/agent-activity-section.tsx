import {
  type ActivityContext,
  useActivityContext,
} from '@app/features/activity/context/activity-context';
import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { formatCompactRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType as PropertyEntityType } from '@service-properties/generated/schemas/entityType';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ActivityRow } from '../components/activity-row';
import { useAgentActivitySource } from '../context/agent-activity-source';
import type { AgentActivityItem, AgentActivityStep } from '../core/fold-rows';
import { stepLabelKey } from '../core/step-label';
import { createPanelState } from '../primitives/create-panel-state';

const PROPERTY_ENTITY_TYPES: Partial<
  Record<AgentActivityItem['entityType'], PropertyEntityType>
> = {
  user: 'USER',
  chat: 'CHAT',
  channel: 'CHANNEL',
  document: 'DOCUMENT',
  project: 'PROJECT',
  email_thread: 'THREAD',
  calendar_event: 'CALENDAR_EVENT',
  call: 'CALL_RECORD',
  crm_company: 'COMPANY',
  crm_contact: 'CONTACT',
  initiative: 'INITIATIVE',
  database_row: 'DATABASE_ROW',
};

const UNSEEN_MS = 8000;
const LOAD_MORE_WITHIN_PX = 120;
const CLOCK_MS = 30_000;
const MOVE_MS = 240;
const ARRIVAL_MS = 1800;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const FADE_PX = 24;

function reducedMotion() {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
  );
}

/** A faded edge wherever the list has more to scroll to. */
function edgeMask(above: boolean, below: boolean): string | undefined {
  if (!above && !below) return undefined;
  const top = above ? `transparent, #000 ${FADE_PX}px` : '#000';
  const bottom = below ? `#000 calc(100% - ${FADE_PX}px), transparent` : '#000';
  return `linear-gradient(${top}, ${bottom})`;
}

export function AgentActivitySection(props: {
  /** The agent is working, so the list can still change. */
  live?: boolean;
}) {
  const source = useAgentActivitySource();
  const activityContext = useActivityContext();
  const rowElements = new Map<string, HTMLElement>();
  let before = new Map<string, number>();
  const state = createPanelState(source, {
    // Where every row was before an update, so it can slide to its new place.
    beforeApply: () => {
      before = new Map(
        [...rowElements].map(([key, element]) => [key, element.offsetTop])
      );
    },
  });
  const sidePanel = useSidePanel();
  // Dots mark what's new since you last looked, not forever.
  const clearSeenSoon = debounce(state.markAllSeen, UNSEEN_MS);
  sidePanel?.reportUnseenCount(state.unseenItemCount);
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
  onCleanup(() => {
    sidePanel?.reportUnseenCount(undefined);
    clearSeenSoon.clear();
    clearInterval(clock);
  });
  createEffect(() => {
    if (sidePanel?.isOpen() && state.unseenItemCount() > 0) clearSeenSoon();
  });
  const [pointerInside, setPointerInside] = createSignal(false);
  const [focusInside, setFocusInside] = createSignal(false);
  const [awayFromTop, setAwayFromTop] = createSignal(false);
  const [awayFromBottom, setAwayFromBottom] = createSignal(false);
  let list: HTMLDivElement | undefined;
  let touchedLast = false;

  const updateHold = () => {
    if (pointerInside() || focusInside() || awayFromTop()) {
      state.hold();
    } else {
      state.release();
    }
  };

  const updateEdges = () => {
    if (!list) return;
    setAwayFromTop(list.scrollTop > 1);
    const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    setAwayFromBottom(fromBottom > 1);
    if (fromBottom < LOAD_MORE_WITHIN_PX) source.loadMore();
    updateHold();
  };

  const catchUp = () => {
    state.catchUp();
    if (list?.scrollTo) {
      list.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else if (list) {
      list.scrollTop = 0;
    }
    updateEdges();
  };

  // Rows slide from where they were, and an updated row flashes as it lands.
  createEffect(
    on(
      () => [
        state
          .items()
          .map((item) => item.key)
          .join('\u0001'),
        state.arrivals(),
      ],
      () => {
        const motion = !reducedMotion();
        for (const [key, element] of rowElements) {
          const was = before.get(key);
          const delta = was === undefined ? 0 : was - element.offsetTop;
          if (motion && delta) {
            element.animate?.(
              [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
              { duration: MOVE_MS, easing: EASE_OUT }
            );
          }
        }
        if (motion) {
          for (const key of state.arrivals()) {
            rowElements
              .get(key)
              ?.animate(
                [
                  { backgroundColor: 'var(--color-selected)' },
                  { backgroundColor: 'transparent' },
                ],
                { duration: ARRIVAL_MS, easing: 'ease-out' }
              );
          }
        }
        before = new Map();
        queueMicrotask(updateEdges);
      },
      { defer: true }
    )
  );

  return (
    <Show when={source.rows().length > 0}>
      <SidePanel.Section
        id="agent-session-activity"
        title={
          <SidePanel.CountTitle
            label={t('agentWork.recentlyShared')}
            count={state.items().length}
          />
        }
        actions={
          <Show when={props.live}>
            <span class="flex items-center gap-1.5 text-[11px] text-ink-subtle">
              <span
                aria-hidden="true"
                class="size-1.5 rounded-full bg-success motion-safe:animate-pulse"
              />
              {t('agentWork.liveActivity')}
            </span>
          </Show>
        }
        defaultOpen
        order={0}
      >
        <div
          class="relative -mx-2"
          data-agent-activity-section
          onPointerEnter={(event) => {
            if (event.pointerType === 'touch') return;
            setPointerInside(true);
            updateHold();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'touch') return;
            setPointerInside(false);
            updateHold();
          }}
          onPointerDown={(event) => {
            touchedLast = event.pointerType === 'touch';
          }}
          onKeyDown={() => {
            touchedLast = false;
          }}
          onFocusIn={() => {
            // A tap's leftover focus doesn't hold the list, or a phone would
            // stop updating after any tap; keyboard and mouse focus do.
            if (touchedLast) return;
            setFocusInside(true);
            updateHold();
          }}
          onFocusOut={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
              return;
            setFocusInside(false);
            updateHold();
          }}
        >
          <Show when={state.unseenCount() > 0}>
            <div class="pointer-events-none absolute inset-x-0 top-1.5 z-10 flex justify-center">
              <Button
                class="pointer-events-auto"
                variant="secondary"
                size="xs"
                onClick={catchUp}
              >
                {t('agentWork.newActivity', { count: state.unseenCount() })}
              </Button>
            </div>
          </Show>
          <div
            ref={(element) => {
              list = element;
              queueMicrotask(updateEdges);
            }}
            class="h-[300px] overflow-y-auto overscroll-contain [overflow-anchor:none]"
            style={{
              'mask-image': edgeMask(awayFromTop(), awayFromBottom()),
              '-webkit-mask-image': edgeMask(awayFromTop(), awayFromBottom()),
            }}
            data-agent-activity-list
            onScroll={updateEdges}
          >
            <For each={state.items()}>
              {(item) => (
                <AgentActivityItemRow
                  item={item}
                  now={now()}
                  entityDisplay={activityContext.entityDisplay}
                  open={state.openKey() === item.key}
                  unseen={state.isUnseen(item.key)}
                  onSeen={() => state.markSeen(item.key)}
                  onToggle={() => {
                    state.markSeen(item.key);
                    state.setOpenKey(
                      state.openKey() === item.key ? undefined : item.key
                    );
                  }}
                  ref={(element) => {
                    rowElements.set(item.key, element);
                    onCleanup(() => rowElements.delete(item.key));
                  }}
                />
              )}
            </For>
          </div>
        </div>
      </SidePanel.Section>
    </Show>
  );
}

function AgentActivityItemRow(props: {
  item: AgentActivityItem;
  /** Re-renders relative times as the clock moves. */
  now: number;
  entityDisplay: ActivityContext['entityDisplay'];
  open: boolean;
  unseen: boolean;
  onSeen: () => void;
  onToggle: () => void;
  ref: (element: HTMLDivElement) => void;
}) {
  const display = usePropertyEntityDisplay(
    () => props.item.entityId,
    () => PROPERTY_ENTITY_TYPES[props.item.entityType]
  );
  const remoteDisplay =
    props.item.entityType === 'database'
      ? props.entityDisplay(
          () => props.item.entityId,
          () => 'DATABASE'
        )
      : props.item.entityType === 'form'
        ? props.entityDisplay(
            () => props.item.entityId,
            () => 'FORM'
          )
        : undefined;
  const entityDisplay = remoteDisplay ?? display;
  const resolvable = () => {
    if (remoteDisplay) {
      return (
        !remoteDisplay.isLoading() &&
        !remoteDisplay.name().toLowerCase().endsWith('unavailable')
      );
    }
    if (props.item.entityType === 'user') return Boolean(display.name());
    if (props.item.entityType === 'channel') {
      return display.name() !== 'Channel';
    }
    if (props.item.entityType === 'initiative') {
      return Boolean(display.nativeProjectId?.());
    }
    return (
      Boolean(PROPERTY_ENTITY_TYPES[props.item.entityType]) &&
      !display.isLoading() &&
      display.hasPreviewAccess()
    );
  };
  const name = createMemo(() => {
    if (!resolvable()) {
      return t('agentWork.entityType', {
        type: props.item.entityType.replaceAll('_', ' '),
      });
    }
    return entityDisplay.name();
  });
  const block = () => (resolvable() ? entityDisplay.blockOrFileType() : null);
  const icon = () =>
    remoteDisplay || PROPERTY_ENTITY_TYPES[props.item.entityType] ? (
      entityDisplay.icon()
    ) : (
      <EntityIcon targetType={props.item.entityType} size="xs" />
    );
  const copyLink = useCopyLink();
  const time = (occurredAt: string) => {
    props.now;
    return formatCompactRelativeTimestamp(occurredAt);
  };
  // Steps arrive newest first; the timeline reads oldest first.
  const steps = () =>
    [...props.item.steps].reverse().map((step) => ({
      key: step.key,
      label: stepText(step),
      time: time(step.latest.occurredAt),
    }));

  return (
    <ActivityRow
      ref={props.ref}
      name={name()}
      icon={icon()}
      latest={props.item.steps[0] ? stepText(props.item.steps[0]) : ''}
      time={time(props.item.latest.occurredAt)}
      unseen={props.unseen}
      steps={steps()}
      expanded={props.open}
      onToggle={props.onToggle}
      onOpen={
        block()
          ? (event) => {
              const target = block();
              if (!target) return;
              props.onSeen();
              openEntityInSplit({
                block: target,
                id: props.item.entityId,
                params: entityDisplay.linkParams(),
                newSplit: event.shiftKey || event.metaKey,
              });
            }
          : undefined
      }
      onCopyLink={
        block()
          ? () => {
              const target = block();
              if (!target) return;
              props.onSeen();
              fireCopy(copyLink, target, props.item.entityId);
            }
          : undefined
      }
    />
  );
}

function fireCopy(
  copyLink: ReturnType<typeof useCopyLink>,
  block: string,
  id: string
) {
  fireAndForget(
    copyLink(buildSimpleEntityUrl({ type: block, id })),
    'agent-session-activity-copy-link'
  );
}

/** "Edited" or "Edited (x3)", translated. */
function stepText(step: AgentActivityStep): string {
  const verb = t(stepLabelKey(step.verb));
  return step.count > 1
    ? t('agentWork.verbCount', { verb, count: step.count })
    : verb;
}
