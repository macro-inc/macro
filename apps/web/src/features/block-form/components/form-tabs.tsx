import { Tabs } from '@kobalte/core/tabs';
import { TabSelector } from '@ui';
import { For } from 'solid-js';

export type FormTab = 'build' | 'responses' | 'share';

const TABS: { value: FormTab; label: string }[] = [
  { value: 'build', label: 'Build' },
  { value: 'responses', label: 'Responses' },
  { value: 'share', label: 'Settings' },
];

export function FormTabs(props: {
  tab: FormTab;
  /** Ties each tab to its panel; unique per mounted form page. */
  idPrefix: string;
  responsesCount: number | undefined;
  onChange: (tab: FormTab) => void;
}) {
  return (
    <TabSelector>
      <Tabs
        value={props.tab}
        onChange={(value) => {
          const tab = TABS.find((tab) => tab.value === value);
          if (tab) props.onChange(tab.value);
        }}
        class="min-w-0"
      >
        <TabSelector.List aria-label="Form">
          <For each={TABS}>
            {(tab) => (
              <TabSelector.Tab
                value={tab.value}
                id={`${props.idPrefix}-tab-${tab.value}`}
                aria-controls={`${props.idPrefix}-panel-${tab.value}`}
              >
                {tab.label}
                {tab.value === 'responses' &&
                props.responsesCount !== undefined ? (
                  <span class="rounded-full bg-active px-1.5 text-[11px] text-ink-muted tabular-nums">
                    {props.responsesCount}
                  </span>
                ) : null}
              </TabSelector.Tab>
            )}
          </For>
        </TabSelector.List>
      </Tabs>
    </TabSelector>
  );
}
