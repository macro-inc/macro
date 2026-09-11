/**
 * The choices an agent offered for a permission request, as buttons. The
 * labels and their order are the agent's own (ACP lists them); only the
 * emphasis is ours — allows read as the primary action, rejects as the quiet
 * one — so a user scanning the row sees at once which way is which.
 */

import { Button } from '@ui';
import { For } from 'solid-js';

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
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={props.options}>
        {(option) => (
          <Button
            size="xs"
            variant={
              option.kind === 'allow_once' || option.kind === 'allow_always'
                ? 'accent'
                : 'outline'
            }
            disabled={props.disabled}
            onClick={() => props.onSelect(option.id)}
          >
            {option.name}
          </Button>
        )}
      </For>
    </div>
  );
}
