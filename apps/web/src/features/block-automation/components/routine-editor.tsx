import { Tabs } from '@kobalte/core/tabs';
import { EntityComposer, ToggleSwitch } from '@ui';
import type { JSX } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';

/** Saved routine settings and history; the host provides its toolbar and controls. */
export function RoutineEditor(props: {
  draft: ScheduleDraft;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  disabled?: boolean;
  activationDisabled?: boolean;
  tab: 'settings' | 'history';
  onTab: (tab: 'settings' | 'history') => void;
  instructions: JSX.Element;
  executionPicker: JSX.Element;
  triggerContent?: JSX.Element;
  history?: JSX.Element;
  actions?: JSX.Element;
  metadata?: JSX.Element;
  status?: JSX.Element;
  feedback?: JSX.Element;
  sharing?: JSX.Element;
}) {
  return (
    <div class="min-h-0 flex-1 overflow-y-auto text-ink">
      <div class="mx-auto w-full max-w-3xl px-6 py-6 sm:px-8 sm:py-8 touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1.5rem)]">
        <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <input
              aria-label="Routine name"
              placeholder="Untitled"
              value={props.draft.name}
              disabled={props.disabled}
              onInput={(e) =>
                props.onChange((d) => ({ ...d, name: e.currentTarget.value }))
              }
              class="w-full rounded-md bg-transparent px-1 py-1 text-xl font-medium outline-none placeholder:text-ink hover:bg-hover/50 focus:bg-hover/50"
            />
            <div class="mt-4 flex flex-wrap items-center gap-4 px-1 text-sm text-ink-muted">
              <ToggleSwitch
                label={props.enabled ? 'Active' : 'Inactive'}
                checked={props.enabled}
                disabled={props.activationDisabled ?? props.disabled}
                onChange={props.onEnabled}
              />
              {props.metadata}
            </div>
          </div>
          {props.actions}
        </div>
        <Tabs
          value={props.tab}
          onChange={(value) => {
            if (value === 'settings' || value === 'history') props.onTab(value);
          }}
        >
          <div class="mb-6 flex items-center gap-1">
            <Tabs.List aria-label="Routine details" class="flex gap-1">
              <Tabs.Trigger
                value="settings"
                class="rounded-full px-4 py-2 text-sm text-ink-muted hover:bg-hover data-selected:bg-hover data-selected:text-ink"
              >
                Settings
              </Tabs.Trigger>
              <Tabs.Trigger
                value="history"
                class="rounded-full px-4 py-2 text-sm text-ink-muted hover:bg-hover data-selected:bg-hover data-selected:text-ink"
              >
                Run History
              </Tabs.Trigger>
            </Tabs.List>
            <div class="ml-auto text-xs text-ink-extra-muted" role="status">
              {props.status}
            </div>
          </div>
          <Tabs.Content value="history">
            {props.history ?? (
              <div class="rounded-lg border border-edge-muted bg-panel px-6 py-24 text-center text-sm text-ink-muted">
                No runs yet
              </div>
            )}
          </Tabs.Content>
          <Tabs.Content value="settings" class="grid gap-6">
            <fieldset
              disabled={props.disabled}
              inert={props.disabled}
              class="grid min-w-0 gap-6"
            >
              <section class="grid gap-3">
                <h2 class="px-1 text-sm text-ink-muted">Agent instructions</h2>
                <div
                  class="rounded-lg border border-edge-muted bg-panel p-4"
                  role="group"
                  aria-label="Agent instructions"
                >
                  {props.instructions}
                </div>
              </section>
              <EntityComposer.Properties aria-label="Routine properties">
                {props.executionPicker}
                {props.triggerContent}
              </EntityComposer.Properties>
            </fieldset>
            {props.feedback}
            {props.sharing}
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  );
}
