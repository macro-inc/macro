import CaretDownIcon from '@phosphor/caret-down.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import type { AccessLevel } from '../core/types';

export function AccessLevelSelect(props: {
  value: AccessLevel;
  levels: readonly AccessLevel[];
  disabled?: boolean;
  label: string;
  onChange(level: AccessLevel): void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="outline"
        disabled={props.disabled}
        aria-label={props.label}
      >
        {props.value === 'edit'
          ? 'Edit'
          : props.value === 'comment'
            ? 'Comment'
            : 'View'}
        <CaretDownIcon class="size-3.5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <For each={props.levels}>
            {(level) => (
              <Dropdown.Item onSelect={() => props.onChange(level)}>
                {level === 'edit'
                  ? 'Edit'
                  : level === 'comment'
                    ? 'Comment'
                    : 'View'}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
