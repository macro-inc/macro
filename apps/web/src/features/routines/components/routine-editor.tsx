import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import ClockIcon from '@icon/system/regular/clock.svg';
import ClockCounterIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { ComposerSurface, cn, TabSelector } from '@ui';
import { createSignal, For, type JSX, type ParentProps, Show } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';
import { RoutineDescription } from './routine-description';

/**
 * The raised card a page section or step sits on: the composer surface
 * settings use (menu fill, glass edge) with a tighter radius, framed on touch
 * as settings are.
 */
export function RoutineSurface(props: ParentProps<{ class?: string }>) {
  return (
    <ComposerSurface
      as="div"
      class={cn(
        'relative min-w-0 rounded-xl touch:rounded-xl touch:border touch:border-edge-muted touch:bg-composer touch:text-composer-ink',
        props.class
      )}
    >
      {props.children}
    </ComposerSurface>
  );
}

/** One setting on a surface: label and description, its control on the right. */
export function RoutineSettingRow(props: {
  label: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <div class="flex min-h-16 items-center gap-4 border-t border-edge-divider px-6 py-4 first:border-t-0 @max-[600px]/routine:px-4">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-base text-ink">{props.label}</span>
        <Show when={props.description}>
          <span class="text-sm text-ink-muted">{props.description}</span>
        </Show>
      </div>
      <div class="shrink-0">{props.children}</div>
    </div>
  );
}

/** A section of the routine page: a heading and its aside over its surface. */
function RoutineSection(props: {
  label: string;
  aside?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section aria-label={props.label} class="grid min-w-0 gap-3">
      <div class="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 px-6 @max-[600px]/routine:px-1">
        <h2 class="text-sm font-medium text-ink-muted">{props.label}</h2>
        <Show when={props.aside}>
          <span class="ml-auto flex min-w-0 items-center gap-2 text-xs text-ink-extra-muted">
            {props.aside}
          </span>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

/** Below the shared side panel's split width, the details panel floats over the page, as in tasks. */
const SPLIT_DETAILS_MIN_PX = 1224;

/**
 * The page's scroller. A floating details card covers the right of the pane,
 * so while it is open the document column makes room for it.
 */
function DocumentScroller(props: ParentProps<{ floating: boolean }>) {
  const panel = useSidePanel();
  const clearance = () =>
    props.floating && panel?.isOpen() ? SidePanel.FLOATING_CLEARANCE_PX : 0;
  return (
    <div
      class="size-full overflow-y-auto @min-[900px]/routine:pr-(--details-clearance)"
      style={{ '--details-clearance': `${clearance()}px` }}
    >
      {props.children}
    </div>
  );
}

/**
 * A routine's page: When and Then in a document column, its settings in the
 * details panel beside it, and a full-width run list.
 */
export function RoutineEditor(props: {
  draft: ScheduleDraft;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  disabled?: boolean;
  tab: 'settings' | 'history';
  onTab: (tab: 'settings' | 'history') => void;
  onBack: () => void;
  /** Right of the header: save state and Run now. */
  headerActions?: JSX.Element;
  /** What the routine does: its agent's instructions or its steps. */
  steps: JSX.Element;
  /** The Then heading's controls, on its line. */
  stepsAside?: JSX.Element;
  /** The Trigger surface's content: triggers and their filters. */
  triggerContent?: JSX.Element;
  /** Under the title: Enabled, owner, last run. */
  meta?: JSX.Element;
  /** The Connections surface's rows; the section shows only with them. */
  connections?: JSX.Element;
  /** The Runs & notifications surface's rows. */
  settings?: JSX.Element;
  /** The Trigger heading's aside; absent before the routine exists. */
  nextRun?: string;
  /** The Runs tab's content; absent while the routine is being created. */
  history?: JSX.Element;
  showHistory?: boolean;
  /** A new routine not yet saved: no tabs, details or menu; `footer` saves it. */
  creating?: boolean;
  /** Below the sections, e.g. a new routine's Cancel and Create. */
  footer?: JSX.Element;
  /** Runs loaded for the Runs tab's count. */
  runCount?: number;
  /** The routine menu, shown right after its name. */
  actions?: JSX.Element;
  feedback?: JSX.Element;
  /** Details panel sections (`SidePanel.Section`, `SidePanel.Footer`). */
  details?: JSX.Element;
}) {
  const tabs = () =>
    props.showHistory === false
      ? [{ value: 'settings', label: 'Overview', count: undefined }]
      : [
          { value: 'settings', label: 'Overview', count: undefined },
          { value: 'history', label: 'Runs', count: props.runCount },
        ];
  const breadcrumbName = () =>
    props.draft.name.trim() || (props.creating ? 'New routine' : 'Untitled');
  const [pane, setPane] = createSignal<HTMLElement>();
  const paneSize = createElementSize(pane);
  // A pane too narrow for the details column gets the floating card instead
  // of a full-screen overlay; until it is measured, assume it is wide.
  const floating = () =>
    paneSize.width !== null && paneSize.width < SPLIT_DETAILS_MIN_PX;
  return (
    <SidePanel.Root persistKey="routine">
      <ViewBreadcrumbs.Root
        value="routine"
        onChange={(value) => {
          if (value === 'routines') props.onBack();
          else props.onTab('settings');
        }}
      >
        <ViewBreadcrumbs.Item value="routines" metadata={{}} order={0}>
          {(item) => (
            <ViewBreadcrumbs.ReturnButton
              onClick={item.onSelect}
              aria-label="Back to routines"
              tooltip="Routines"
            >
              Routines
            </ViewBreadcrumbs.ReturnButton>
          )}
        </ViewBreadcrumbs.Item>
        <ViewBreadcrumbs.Item value="routine" metadata={{}} order={1}>
          {(item) => (
            <div class="flex min-w-0 items-center">
              <ViewBreadcrumbs.Button
                class="gap-1.5"
                isActive={item.isActive()}
                onClick={item.onSelect}
                tooltip={breadcrumbName()}
              >
                <ClockIcon class="size-3 shrink-0" />
                <span class="truncate">{breadcrumbName()}</span>
              </ViewBreadcrumbs.Button>
              <Show when={props.actions}>
                <div class="shrink-0">{props.actions}</div>
              </Show>
            </div>
          )}
        </ViewBreadcrumbs.Item>
        <TabSelector.Root
          value={props.tab}
          onChange={(value) => {
            if (value === 'settings' || value === 'history') props.onTab(value);
          }}
          class="@container/routine flex size-full min-h-0 min-w-0 flex-col text-ink"
        >
          <ViewShell.TopBar
            class="gap-x-3 gap-y-2 touch:flex @max-[600px]/routine:h-auto @max-[600px]/routine:flex-wrap"
            aria-label="Routine toolbar"
          >
            <ViewBreadcrumbs.Outlet
              aria-label="Routine location"
              class="min-w-0 @max-[600px]/routine:flex-1"
            />
            <Show when={!props.creating}>
              <div class="shrink-0 @max-[600px]/routine:order-last @max-[600px]/routine:w-full">
                <TabSelector class="w-fit">
                  <TabSelector.List aria-label="Routine details">
                    <For each={tabs()}>
                      {(tab) => (
                        <TabSelector.Tab value={tab.value}>
                          {tab.label}
                          <Show when={tab.count}>
                            {(count) => (
                              <span
                                aria-hidden="true"
                                class="ml-1.5 tabular-nums text-ink-extra-muted"
                              >
                                {count()}
                              </span>
                            )}
                          </Show>
                        </TabSelector.Tab>
                      )}
                    </For>
                  </TabSelector.List>
                </TabSelector>
              </div>
            </Show>
            <div class="ml-auto flex shrink-0 items-center gap-2">
              {props.headerActions}
              <Show when={props.tab === 'settings' && !props.creating}>
                <SidePanel.Toggle size="sm" />
              </Show>
            </div>
          </ViewShell.TopBar>
          <TabSelector.Panel
            ref={setPane}
            value="settings"
            class="relative min-h-0 flex-1 outline-none"
          >
            <SidePanel.Layout headerToggle={false} floating={floating()}>
              <DocumentScroller floating={floating()}>
                <div class="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-10 pb-18 pt-10 @max-[600px]/routine:px-4 touch:pt-6">
                  <header class="flex min-w-0 flex-col gap-3">
                    <span
                      aria-hidden="true"
                      class="flex size-11 items-center justify-center rounded-xl bg-accent-bg text-accent"
                    >
                      <ClockCounterIcon class="size-5.5" />
                    </span>
                    <div class="min-w-0">
                      <Show
                        when={!props.disabled}
                        fallback={
                          <h1 class="min-w-0 truncate text-[28px] font-semibold leading-[34px]">
                            {props.draft.name}
                          </h1>
                        }
                      >
                        <InlineTitleEditor
                          value={props.draft.name}
                          placeholder="Routine name"
                          ariaLabel="Routine name"
                          class="text-[28px] leading-[34px]"
                          onRename={(name) =>
                            props.onChange((draft) => ({ ...draft, name }))
                          }
                        />
                      </Show>
                    </div>
                    <Show
                      when={!props.disabled}
                      fallback={
                        <Show when={props.draft.description}>
                          <p class="whitespace-pre-wrap text-base text-ink-muted">
                            {props.draft.description}
                          </p>
                        </Show>
                      }
                    >
                      <RoutineDescription
                        class="-mt-1.5"
                        value={props.draft.description ?? ''}
                        onChange={(description) =>
                          props.onChange((draft) => ({ ...draft, description }))
                        }
                      />
                    </Show>
                    <Show when={props.meta}>
                      <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-muted">
                        {props.meta}
                      </div>
                    </Show>
                  </header>
                  <RoutineSection
                    label="Trigger"
                    aside={props.nextRun && `Next run: ${props.nextRun}`}
                  >
                    <RoutineSurface class="px-6 py-5 @max-[600px]/routine:px-4">
                      <fieldset
                        aria-label="Routine triggers"
                        disabled={props.disabled}
                        inert={props.disabled}
                        class="min-w-0"
                      >
                        {props.triggerContent}
                      </fieldset>
                    </RoutineSurface>
                  </RoutineSection>
                  <RoutineSection label="Steps" aside={props.stepsAside}>
                    {/* Each step is its own card. */}
                    <fieldset
                      disabled={props.disabled}
                      inert={props.disabled}
                      class="min-w-0"
                      aria-label="Routine steps"
                    >
                      {props.steps}
                    </fieldset>
                  </RoutineSection>
                  <Show when={props.connections}>
                    {(connections) => (
                      <RoutineSection
                        label="Connections"
                        aside="Apps Ask AI steps can use, on top of the agent’s own"
                      >
                        <RoutineSurface>
                          <fieldset
                            disabled={props.disabled}
                            inert={props.disabled}
                            class="min-w-0"
                            aria-label="Routine connections"
                          >
                            {connections()}
                          </fieldset>
                        </RoutineSurface>
                      </RoutineSection>
                    )}
                  </Show>
                  <Show when={props.settings}>
                    {(settings) => (
                      <RoutineSection label="Runs & notifications">
                        <RoutineSurface>{settings()}</RoutineSurface>
                      </RoutineSection>
                    )}
                  </Show>
                  <Show when={props.feedback}>
                    <div class="grid gap-2 empty:hidden">{props.feedback}</div>
                  </Show>
                  <Show when={props.footer}>
                    <div class="flex items-center justify-end gap-2">
                      {props.footer}
                    </div>
                  </Show>
                </div>
              </DocumentScroller>
              {props.details}
            </SidePanel.Layout>
          </TabSelector.Panel>
          <TabSelector.Panel
            value="history"
            class="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
          >
            {props.history}
          </TabSelector.Panel>
        </TabSelector.Root>
      </ViewBreadcrumbs.Root>
    </SidePanel.Root>
  );
}
