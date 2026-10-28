import { Button, Hotkey } from '@ui';
import type { CreatableBlock } from '../types';

/** The shared primary action for the create menu's bottom lip. */
export function CreateMenuAction(props: {
  item: CreatableBlock;
  shiftHeld?: boolean;
  onChoose: (item: CreatableBlock) => void;
}) {
  return (
    <Button
      size="md"
      variant="cta"
      class="h-8 rounded-full px-4 font-medium [--color-accent:#fff] [--color-accent-contrast:#000] light-mode:[--color-accent:#000] light-mode:[--color-accent-contrast:#fff]"
      aria-label={`Create ${props.item.label}${props.shiftHeld ? ' in new split' : ''}`}
      onClick={() => props.onChoose(props.item)}
    >
      {props.shiftHeld ? 'Create in new split' : `Create ${props.item.label}`}
      <Hotkey
        shortcut={props.shiftHeld ? 'shift+enter' : 'enter'}
        class="text-xs opacity-55"
        aria-hidden="true"
      />
    </Button>
  );
}
