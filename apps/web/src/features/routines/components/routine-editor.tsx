import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { Tabs } from '@kobalte/core/tabs';
import ClockIcon from '@phosphor/clock.svg';
import { cn, EntityComposer, Layer } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';

/** A project-style overview and full-width run list, inside the current pane. */
export function RoutineEditor(props: {
  draft: ScheduleDraft;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  disabled?: boolean;
  tab: 'settings' | 'history';
  onTab: (tab: 'settings' | 'history') => void;
  onBack: () => void;
  enabled: boolean;
  runActions?: JSX.Element;
  instructions: JSX.Element;
  executionPicker: JSX.Element;
  triggerContent?: JSX.Element;
  nextRun: string;
  history: JSX.Element;
  actions?: JSX.Element;
  feedback?: JSX.Element;
}) {
  return (
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
            <div class="shrink-0">{props.actions}</div>
          </div>
        )}
      </ViewBreadcrumbs.Item>
      <Tabs
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
            <Layer depth={0}>
              <Tabs.List
                aria-label="Routine details"
                class="inline-flex shrink-0 items-center rounded-full border border-edge-muted bg-surface p-0.5"
              >
                <For
                  each={[
                    { value: 'settings', label: 'Overview' },
                    { value: 'history', label: 'Run History' },
                  ]}
                >
                  {(tab) => (
                    <Layer depth={2}>
                      <Tabs.Trigger
                        value={tab.value}
                        class="rounded-full px-3 py-1 text-xs font-medium text-ink-extra-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus data-selected:bg-surface data-selected:text-ink data-selected:ring data-selected:ring-inset data-selected:ring-edge-muted"
                      >
                        {tab.label}
                      </Tabs.Trigger>
                    </Layer>
                  )}
                </For>
              </Tabs.List>
            </Layer>
          </div>
        </ViewShell.TopBar>
        <Tabs.Content
          value="settings"
          class="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-12 outline-none touch:pt-6"
        >
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
            <fieldset
              disabled={props.disabled}
              inert={props.disabled}
              class="mt-3 min-w-0"
            >
              <EntityComposer.Properties aria-label="Routine properties">
                {props.executionPicker}
              </EntityComposer.Properties>
            </fieldset>
            <Layer depth={1}>
              <section
                aria-label="Routine triggers"
                class="mt-4 rounded-xl border border-edge-muted bg-surface"
              >
                <div class="flex items-start gap-4 p-4">
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
                </div>
                <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge-muted px-4 py-3 text-xs">
                  <span
                    aria-label="Routine status"
                    class="inline-flex items-center gap-2 text-ink-muted"
                  >
                    <span
                      aria-hidden="true"
                      class={cn(
                        'size-1.5 rounded-full',
                        props.enabled ? 'bg-accent' : 'bg-ink-extra-muted'
                      )}
                    />
                    {props.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <div
                    class="flex min-w-0 items-center gap-2"
                    aria-label="Next run"
                  >
                    <ClockIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                    <span class="shrink-0 text-ink-muted">Next run</span>
                    <span>{props.nextRun}</span>
                  </div>
                </div>
              </section>
            </Layer>
            <fieldset
              disabled={props.disabled}
              inert={props.disabled}
              class="mt-6 min-w-0"
              aria-label="Routine instructions"
            >
              {props.instructions}
            </fieldset>
            <div class="mt-4 grid gap-2">{props.feedback}</div>
          </div>
        </Tabs.Content>
        <Tabs.Content
          value="history"
          class="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        >
          {props.history}
        </Tabs.Content>
      </Tabs>
    </ViewBreadcrumbs.Root>
  );
}
