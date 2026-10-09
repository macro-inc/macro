/**
 * One-time decisions stay close at hand. Additional choices retain the
 * agent's full wording in a menu so remembered rules can be read before use.
 */

import CaretDown from '@phosphor/caret-down.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

export type PermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export type PermissionOptionItem = {
  id: string;
  name: string;
  kind: PermissionOptionKind;
};

export type PermissionOptionsProps = {
  options: readonly PermissionOptionItem[];
  /** An answer is on the wire: nothing here can be clicked again. */
  disabled?: boolean;
  onSelect: (optionId: string) => void;
};

export function PermissionOptions(props: PermissionOptionsProps) {
  // Multiple choices of the same kind can grant different scopes. Keep
  // those in the menu with their full wording instead of merging them.
  const unique = (kind: PermissionOptionKind) => {
    const options = props.options.filter((option) => option.kind === kind);
    return options.length === 1 ? options[0] : undefined;
  };
  const allow = () => unique('allow_once');
  const deny = () => unique('reject_once');
  const more = () =>
    props.options.filter(
      (option) => option.id !== allow()?.id && option.id !== deny()?.id
    );

  return (
    <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <Show when={deny()}>
        {(option) => (
          <Button
            type="button"
            size="md"
            variant="ghost"
            class="mr-auto"
            tooltip={option().name}
            disabled={props.disabled}
            onClick={() => props.onSelect(option().id)}
          >
            Deny
          </Button>
        )}
      </Show>
      <Show when={more().length > 0}>
        <Dropdown placement="top-end">
          <Dropdown.Trigger
            size="md"
            variant="outline"
            disabled={props.disabled}
          >
            More options
            <CaretDown />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-80 max-w-[calc(100vw-2rem)]">
            <Dropdown.Group class="max-h-64 overflow-y-auto">
              <For each={more()}>
                {(option) => (
                  <Dropdown.Item
                    class="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal px-3 py-2.5"
                    disabled={props.disabled}
                    onSelect={() => props.onSelect(option.id)}
                    textValue={option.name}
                  >
                    <span class="text-sm font-medium text-ink">
                      {permissionOptionLabel(option.kind)}
                    </span>
                    <span class="w-full text-xs leading-5 whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
                      {option.name}
                    </span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Show>
      <Show when={allow()}>
        {(option) => (
          <Button
            type="button"
            size="md"
            variant="strong"
            tooltip={option().name}
            disabled={props.disabled}
            onClick={() => props.onSelect(option().id)}
          >
            Allow once
          </Button>
        )}
      </Show>
    </div>
  );
}

function permissionOptionLabel(kind: PermissionOptionKind): string {
  return match(kind)
    .with('allow_once', () => 'Allow once')
    .with('allow_always', () => 'Remember approval')
    .with('reject_once', () => 'Deny')
    .with('reject_always', () => 'Remember denial')
    .exhaustive();
}
