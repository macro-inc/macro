import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SidePanel } from '@components/app/side-panel';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import ClockIcon from '@icon/system/regular/clock.svg';
import { EntityComposer, Layer, TabSelector } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';

function SectionLabel(props: { children: JSX.Element; aside?: JSX.Element }) {
  return (
    <div class="mb-2 mt-6 flex items-center justify-between gap-3">
      <h2 class="text-xs font-medium text-ink-extra-muted">{props.children}</h2>
      <Show when={props.aside}>
        <span class="text-xs text-ink-extra-muted">{props.aside}</span>
      </Show>
    </div>
  );
}

/**
 * A routine's page: When and Then in a document column, its settings in the
 * details panel tasks and documents use, and a full-width run list.
 */
export function RoutineEditor(props: {
  draft: ScheduleDraft;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  disabled?: boolean;
  tab: 'settings' | 'history';
  onTab: (tab: 'settings' | 'history') => void;
  onBack: () => void;
  runActions?: JSX.Element;
  /** What the routine does: its agent's instructions or its steps. */
  steps: JSX.Element;
  triggerContent?: JSX.Element;
  nextRun: string;
  history: JSX.Element;
  showHistory?: boolean;
  /** The routine menu, shown right after its name. */
  actions?: JSX.Element;
  feedback?: JSX.Element;
  /** Details panel sections (`SidePanel.Section`, `SidePanel.Footer`). */
  details?: JSX.Element;
}) {
  return (
    <SidePanel.Root floating>
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
                  <For
                    each={
                      props.showHistory === false
                        ? [{ value: 'settings', label: 'Overview' }]
                        : [
                            { value: 'settings', label: 'Overview' },
                            { value: 'history', label: 'Runs' },
                          ]
                    }
                  >
                    {(tab) => (
                      <TabSelector.Tab value={tab.value}>
                        {tab.label}
                      </TabSelector.Tab>
                    )}
                  </For>
                </TabSelector.List>
              </TabSelector>
            </div>
            <Show when={props.tab === 'settings'}>
              <div class="ml-auto flex shrink-0 items-center">
                <SidePanel.Toggle />
              </div>
            </Show>
          </ViewShell.TopBar>
          <TabSelector.Panel
            value="settings"
            class="relative min-h-0 flex-1 outline-none"
          >
            <SidePanel.Layout floating headerToggle={false}>
              <div class="size-full overflow-y-auto px-6 pb-8 pt-12 touch:pt-6">
                <div class="mx-auto max-w-3xl">
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
                  <SectionLabel aside={`Next run: ${props.nextRun}`}>
                    When
                  </SectionLabel>
                  <Layer depth={1}>
                    <section
                      aria-label="Routine triggers"
                      class="flex items-start gap-4 rounded-xl border border-edge-muted bg-surface p-4"
                    >
                      <fieldset
                        disabled={props.disabled}
                        inert={props.disabled}
                        class="min-w-0 flex-1"
                      >
                        <EntityComposer.Properties aria-label="Triggers">
                          {props.triggerContent}
                        </EntityComposer.Properties>
                      </fieldset>
                      <div class="shrink-0">{props.runActions}</div>
                    </section>
                  </Layer>
                  <SectionLabel>Then</SectionLabel>
                  <fieldset
                    disabled={props.disabled}
                    inert={props.disabled}
                    class="min-w-0"
                    aria-label="Routine steps"
                  >
                    <Layer depth={1}>{props.steps}</Layer>
                  </fieldset>
                  <div class="mt-4 grid gap-2">{props.feedback}</div>
                </div>
              </div>
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
