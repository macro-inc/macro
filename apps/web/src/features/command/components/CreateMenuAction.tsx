import { t } from '@app/lib/i18n';
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
      variant="primary"
      class="h-8 rounded-full px-4 font-medium"
      aria-label={t(
        props.shiftHeld ? 'create.createItemInNewSplit' : 'create.createItem',
        { label: props.item.label }
      )}
      onClick={() => props.onChoose(props.item)}
    >
      {props.shiftHeld
        ? t('create.createInNewSplit')
        : t('create.createItem', { label: props.item.label })}
      <Hotkey
        shortcut={props.shiftHeld ? 'shift+enter' : 'enter'}
        class="text-xs opacity-55"
        aria-hidden="true"
      />
    </Button>
  );
}
