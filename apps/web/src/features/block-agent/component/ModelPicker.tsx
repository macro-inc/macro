import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { badgeTriggerClasses, cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import {
  type ModelOption,
  type ModelShortlist,
  modelPillLabel,
  type PersonaOption,
  personaDefaultLabel,
} from './compose-agent-session-options';

/** The composer pills share the task composer's outline pill look. */
export const PILL_CLASS = badgeTriggerClasses({
  variant: 'outline',
  size: 'sm',
  class:
    'max-w-64 gap-1.5 px-2 text-ink-muted data-expanded:bg-hover data-expanded:text-ink',
});

/**
 * Pill that pins a new session to a model other than its agent's default:
 * the default leads, a featured shortlist follows, and the rest of the
 * catalog sits behind "More models".
 */
export function ModelPicker(props: {
  persona: PersonaOption | undefined;
  available: ModelOption[];
  shortlist: ModelShortlist;
  value: string;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const label = () =>
    modelPillLabel(props.value, props.persona, props.available);
  return (
    <Dropdown placement="top-start">
      <Dropdown.Trigger
        variant="outline"
        size="sm"
        class={PILL_CLASS}
        aria-label="Model override"
        disabled={props.disabled}
        tooltip={props.value ? 'Model override' : 'Model (agent default)'}
      >
        <span class={cn('min-w-0 truncate', props.value && 'text-ink')}>
          {label()}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-current/70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
        <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
          <Dropdown.GroupLabel>Model</Dropdown.GroupLabel>
          <ModelRow
            label={personaDefaultLabel(props.persona, props.available)}
            selected={props.value === ''}
            onSelect={() => props.onSelect('')}
          />
          <For each={props.shortlist.featured}>
            {(model) => (
              <ModelRow
                label={model.name}
                selected={props.value === model.id}
                onSelect={() => props.onSelect(model.id)}
              />
            )}
          </For>
          <Show when={props.shortlist.more.length > 0}>
            <Dropdown.Sub>
              <Dropdown.SubTrigger class="h-8">
                <span class="truncate">More models</span>
                <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
                  {props.shortlist.more.length}
                  <CaretRightIcon class="size-3" />
                </span>
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
                <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
                  <For each={props.shortlist.more}>
                    {(model) => (
                      <ModelRow
                        label={model.name}
                        hint={model.group}
                        selected={props.value === model.id}
                        onSelect={() => props.onSelect(model.id)}
                      />
                    )}
                  </For>
                </Dropdown.Group>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Show>
          <Show when={props.loading}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              Loading models…
            </div>
          </Show>
          <Show when={!props.loading && props.available.length === 0}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              This agent's harness did not report any models.
            </div>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function ModelRow(props: {
  label: string;
  /** Trailing muted text, e.g. the family a model belongs to. */
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      class={cn('h-8 gap-2', props.selected && 'bg-ink/5 text-ink font-medium')}
      onSelect={props.onSelect}
    >
      <span class="min-w-0 flex-1 truncate text-sm">{props.label}</span>
      <Show when={props.hint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">{props.hint}</span>
      </Show>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-accent" />
      </Show>
    </Dropdown.Item>
  );
}
