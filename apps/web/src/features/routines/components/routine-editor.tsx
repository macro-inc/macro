import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import ClockIcon from '@icon/system/regular/clock.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Layer, TabSelector } from '@ui';
import { createSignal, For, type JSX, type ParentProps, Show } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';

/** A section of the routine page: a small uppercase heading over its content. */
function RoutineSection(props: {
  label: string;
  aside?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section aria-label={props.label} class="grid min-w-0 gap-2.5">
      <div class="flex min-h-5 items-center gap-2">
        <h2 class="text-xs font-semibold uppercase tracking-[0.04em] text-ink-extra-muted">
          {props.label}
        </h2>
        <span class="flex-1" />
        <Show when={props.aside}>
          <span class="flex min-w-0 items-center gap-2 truncate text-xs text-ink-extra-muted">
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
  /** The When card's rows: triggers and their conditions. */
  triggerContent?: JSX.Element;
  nextRun: string;
  history: JSX.Element;
  showHistory?: boolean;
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
                tooltip={props.draft.name}
              >
                <ClockIcon class="size-3 shrink-0" />
                <span class="truncate">{props.draft.name}</span>
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
            <div class="ml-auto flex shrink-0 items-center gap-2">
              {props.headerActions}
              <Show when={props.tab === 'settings'}>
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
                <div class="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-10 pb-16 pt-8 @max-[600px]/routine:px-4 touch:pt-6">
                  <div class="min-w-0">
                    <Show
                      when={!props.disabled}
                      fallback={
                        <h1 class="min-w-0 truncate text-2xl font-semibold">
                          {props.draft.name}
                        </h1>
                      }
                    >
                      <InlineTitleEditor
                        value={props.draft.name}
                        placeholder="Routine name"
                        ariaLabel="Routine name"
                        class="text-2xl"
                        onRename={(name) =>
                          props.onChange((draft) => ({ ...draft, name }))
                        }
                      />
                    </Show>
                  </div>
                  <RoutineSection
                    label="When"
                    aside={`Next run: ${props.nextRun}`}
                  >
                    <Layer depth={1}>
                      <fieldset
                        aria-label="Routine triggers"
                        disabled={props.disabled}
                        inert={props.disabled}
                        class="min-w-0 rounded-xl border border-edge-muted bg-surface px-3 py-2.5"
                      >
                        {props.triggerContent}
                      </fieldset>
                    </Layer>
                  </RoutineSection>
                  <RoutineSection label="Then" aside={props.stepsAside}>
                    <fieldset
                      disabled={props.disabled}
                      inert={props.disabled}
                      class="min-w-0"
                      aria-label="Routine steps"
                    >
                      <Layer depth={1}>{props.steps}</Layer>
                    </fieldset>
                  </RoutineSection>
                  <Show when={props.feedback}>
                    <div class="grid gap-2 empty:hidden">{props.feedback}</div>
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
