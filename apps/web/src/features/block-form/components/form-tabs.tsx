import { cn } from '@ui';
import { For, type JSX } from 'solid-js';

export type FormTab = 'build' | 'responses' | 'share';

const TABS: { value: FormTab; label: string }[] = [
  { value: 'build', label: 'Build' },
  { value: 'responses', label: 'Responses' },
  { value: 'share', label: 'Share' },
];

/** Build, Responses, Share, with the form's status at the right. */
export function FormTabs(props: {
  tab: FormTab;
  /** Ties each tab to its panel; unique per mounted form page. */
  idPrefix: string;
  status: JSX.Element;
  responsesCount: number | undefined;
  onChange: (tab: FormTab) => void;
}) {
  const select = (
    event: KeyboardEvent & { currentTarget: HTMLButtonElement },
    index: number
  ) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    props.onChange(TABS[next].value);
    const list = event.currentTarget.parentElement;
    list?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div class="flex items-center gap-3 border-b border-edge-divider bg-surface px-3">
      <div role="tablist" aria-label="Form" class="flex items-end gap-1">
        <For each={TABS}>
          {(tab, index) => (
            <button
              type="button"
              role="tab"
              id={`${props.idPrefix}-tab-${tab.value}`}
              aria-selected={props.tab === tab.value}
              aria-controls={`${props.idPrefix}-panel-${tab.value}`}
              tabIndex={props.tab === tab.value ? 0 : -1}
              class={cn(
                '-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-edge-focus focus-visible:ring-inset',
                props.tab === tab.value
                  ? 'border-accent font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              )}
              onClick={() => props.onChange(tab.value)}
              onKeyDown={(event) => select(event, index())}
            >
              {tab.label}
              {tab.value === 'responses' &&
              props.responsesCount !== undefined ? (
                <span class="rounded-full bg-active px-1.5 text-[11px] text-ink-muted tabular-nums">
                  {props.responsesCount}
                </span>
              ) : null}
            </button>
          )}
        </For>
      </div>
      <div class="ml-auto min-w-0 truncate text-xs text-ink-muted">
        {props.status}
      </div>
    </div>
  );
}
