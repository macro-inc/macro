import { EntityMention } from '@app/features/activity/components/entity-mention';
import {
  type ActivityContext,
  useActivityContext,
} from '@app/features/activity/context/activity-context';
import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import { debounce } from '@core/util/debounce';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
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
import { TransitionGroup } from 'solid-transition-group';
import { useAgentActivitySource } from '../context/agent-activity-source';
import type { AgentActivityItem, AgentActivityStep } from '../core/fold-rows';
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

export function AgentActivitySection() {
  const source = useAgentActivitySource();
  const activityContext = useActivityContext();
  const state = createPanelState(source);
  const sidePanel = useSidePanel();
  // Dots mark what's new since you last looked, not forever.
  const clearSeenSoon = debounce(state.markAllSeen, UNSEEN_MS);
  sidePanel?.reportUnseenCount(state.unseenItemCount);
  onCleanup(() => {
    sidePanel?.reportUnseenCount(undefined);
    clearSeenSoon.clear();
  });
  createEffect(() => {
    if (sidePanel?.isOpen() && state.unseenItemCount() > 0) clearSeenSoon();
  });
  const [pointerInside, setPointerInside] = createSignal(false);
  const [focusInside, setFocusInside] = createSignal(false);
  const [awayFromTop, setAwayFromTop] = createSignal(false);
  const [awayFromBottom, setAwayFromBottom] = createSignal(false);
  let list: HTMLDivElement | undefined;

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

  createEffect(
    on(
      () => [state.items().length, state.openKey()],
      () => queueMicrotask(updateEdges)
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
        defaultOpen
        order={0}
      >
        <div
          class="relative"
          data-agent-activity-section
          onPointerEnter={() => {
            setPointerInside(true);
            updateHold();
          }}
          onPointerLeave={() => {
            setPointerInside(false);
            updateHold();
          }}
          onFocusIn={() => {
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
            <div class="absolute inset-x-0 top-1 z-10 flex justify-center">
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  state.catchUp();
                  if (list) list.scrollTop = 0;
                  updateEdges();
                }}
              >
                {t('agentWork.newActivity', { count: state.unseenCount() })}
              </Button>
            </div>
          </Show>
          <Show when={awayFromTop()}>
            <div class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-4 bg-gradient-to-b from-surface to-transparent" />
          </Show>
          <div
            ref={(element) => {
              list = element;
              queueMicrotask(updateEdges);
            }}
            class="h-[300px] overflow-y-auto overscroll-contain"
            data-agent-activity-list
            onScroll={updateEdges}
          >
            <TransitionGroup moveClass="transition-transform duration-200 ease-out motion-reduce:transition-none">
              <For each={state.items()}>
                {(item) => (
                  <AgentActivityItemRow
                    item={item}
                    entityDisplay={activityContext.entityDisplay}
                    open={state.openKey() === item.key}
                    unseen={state.isUnseen(item.key)}
                    onToggle={() => {
                      state.markSeen(item.key);
                      state.setOpenKey(
                        state.openKey() === item.key ? undefined : item.key
                      );
                    }}
                  />
                )}
              </For>
            </TransitionGroup>
          </div>
          <Show when={awayFromBottom()}>
            <div class="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-surface to-transparent" />
          </Show>
        </div>
      </SidePanel.Section>
    </Show>
  );
}

function AgentActivityItemRow(props: {
  item: AgentActivityItem;
  entityDisplay: ActivityContext['entityDisplay'];
  open: boolean;
  unseen: boolean;
  onToggle: () => void;
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
  const mentionDisplay = {
    ...entityDisplay,
    name,
    icon: () =>
      remoteDisplay || PROPERTY_ENTITY_TYPES[props.item.entityType] ? (
        entityDisplay.icon()
      ) : (
        <EntityIcon targetType={props.item.entityType} size="xs" />
      ),
    blockOrFileType: () =>
      resolvable() ? entityDisplay.blockOrFileType() : null,
  };
  const latest = () => props.item.steps[0];

  const multiple = () => props.item.steps.length > 1;
  const expanded = () => props.open && multiple();

  return (
    <div data-agent-activity-item={props.item.key}>
      <div class="flex touch:min-h-11 flex-col justify-center rounded-lg px-1 py-1 not-touch:hover:bg-hover">
        <div class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
            <EntityMention
              entityId={props.item.entityId}
              display={mentionDisplay}
            />
          </span>
          <Show when={props.unseen}>
            <span
              class="size-1.5 shrink-0 rounded-full bg-accent"
              aria-label={t('agentWork.unseenActivity')}
            />
          </Show>
          <span class="shrink-0 text-[11px] tabular-nums text-ink-extra-muted">
            {formatRelativeTimestamp(new Date(props.item.latest.occurredAt), {
              condensed: true,
            })}
          </span>
        </div>
        <Show
          when={multiple()}
          fallback={
            <span class="pl-5.5 text-[11px] leading-4 text-ink-muted">
              <Show when={latest()}>
                {(step) => <StepLabel step={step()} />}
              </Show>
            </span>
          }
        >
          <button
            type="button"
            class="flex w-full min-w-0 items-center justify-between gap-2 rounded pl-5.5 text-left text-[11px] leading-4 text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={expanded()}
            aria-label={t('agentWork.showEntityActivity', { name: name() })}
            onClick={props.onToggle}
          >
            <span class="truncate">
              <Show when={latest()}>
                {(step) => <StepLabel step={step()} />}
              </Show>
            </span>
            <span class="flex shrink-0 items-center gap-0.5 tabular-nums">
              {props.item.steps.length}
              <CaretDownIcon
                class={`size-3 transition-transform ${expanded() ? 'rotate-180' : ''}`}
              />
            </span>
          </button>
        </Show>
      </div>
      <Show when={multiple()}>
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
          classList={{
            'grid-rows-[0fr]': !expanded(),
            'grid-rows-[1fr]': expanded(),
          }}
          inert={!expanded()}
        >
          <div class="min-h-0 overflow-hidden">
            <div class="ml-2.5 border-l border-edge-muted pb-1 pl-3.5">
              <For each={[...props.item.steps].reverse()}>
                {(step) => (
                  <div class="flex min-h-6 items-center justify-between gap-2 text-[11px] text-ink-muted touch:min-h-9">
                    <span>
                      <StepLabel step={step} />
                    </span>
                    <span class="tabular-nums text-ink-extra-muted">
                      {formatRelativeTimestamp(
                        new Date(step.latest.occurredAt),
                        {
                          condensed: true,
                        }
                      )}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function StepLabel(props: { step: AgentActivityStep }) {
  const verb = () =>
    props.step.verb.charAt(0).toUpperCase() + props.step.verb.slice(1);
  return (
    <>
      {props.step.rows.length > 1
        ? t('agentWork.verbCount', {
            verb: verb(),
            count: props.step.rows.length,
          })
        : verb()}
    </>
  );
}
