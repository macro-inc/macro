import CheckIcon from '@icon/system/regular/check.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
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
    label: 'Hidden',
    description:
      'Runs stay in this routine’s history. Agents shows them on request.',
  },
  {
    value: 'listed',
    label: 'Shown',
    description: 'Runs appear in Home and Agents like your own sessions.',
  },
];

/**
 * Whether the routine's runs appear in Home and the Agents list: a chip in the
 * composer. The routine's page sets it with a switch.
 */
export function RoutineRunVisibility(props: {
  value: RunVisibility;
  onChange(value: RunVisibility): void;
  disabled?: boolean;
}) {
  const listed = () => props.value === 'listed';
  return (
    <Dropdown modal={false} placement="bottom-start">
      <Dropdown.Trigger
        class="rounded-full text-ink-muted"
        disabled={props.disabled}
      >
        <Show when={listed()} fallback={<EyeSlashIcon class="size-3.5" />}>
          <EyeIcon class="size-3.5" />
        </Show>
        {listed() ? 'Runs shown' : 'Runs hidden'}
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
