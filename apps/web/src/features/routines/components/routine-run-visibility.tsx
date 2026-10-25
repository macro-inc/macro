import CheckIcon from '@phosphor/check.svg';
import EyeIcon from '@phosphor/eye.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { RunVisibility } from '../core/draft';

const OPTIONS: {
  value: RunVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: 'unlisted',
    label: 'Hide runs',
    description:
      'Runs stay in this routine’s history. Agents shows them on request.',
  },
  {
    value: 'listed',
    label: 'Show runs',
    description: 'Runs appear in Home and Agents like your own sessions.',
  },
];

/** Whether the routine's runs appear in Home and the Agents list. */
export function RoutineRunVisibility(props: {
  value: RunVisibility;
  onChange(value: RunVisibility): void;
}) {
  return (
    <Dropdown modal={false} placement="bottom-start">
      <Dropdown.Trigger class="rounded-full text-ink-muted">
        <Show
          when={props.value === 'listed'}
          fallback={<EyeSlashIcon class="size-3.5" />}
        >
          <EyeIcon class="size-3.5" />
        </Show>
        {props.value === 'listed' ? 'Runs shown' : 'Runs hidden'}
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        class="w-72 max-w-[calc(100vw-1rem)]"
      >
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.value}
            onChange={(value) =>
              props.onChange(value === 'listed' ? 'listed' : 'unlisted')
            }
          >
            <For each={OPTIONS}>
              {(option) => (
                <Dropdown.RadioItem value={option.value}>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <Dropdown.ItemLabel>{option.label}</Dropdown.ItemLabel>
                    <Dropdown.ItemDescription class="text-xs text-ink-muted">
                      {option.description}
                    </Dropdown.ItemDescription>
                  </span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
