import { Button } from '@ui';
import { Show } from 'solid-js';

export function ScreenToolbar(props: {
  canControl: boolean;
  controlling: boolean;
  onToggleControl: () => void;
  onClose: () => void;
}) {
  return (
    <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted p-2">
      <span class="mr-auto text-sm font-medium">
        Screen · {props.controlling ? 'Controlling' : 'Watching'}
      </span>
      <Show when={props.canControl}>
        <Button size="sm" variant="secondary" onClick={props.onToggleControl}>
          {props.controlling ? 'Stop controlling' : 'Take control'}
        </Button>
      </Show>
      <Button size="sm" variant="ghost" onClick={props.onClose}>
        Close screen
      </Button>
    </header>
  );
}
