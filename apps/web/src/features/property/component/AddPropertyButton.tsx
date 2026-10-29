import PlusIcon from '@icon/system/regular/plus.svg';
import {
  type BadgeSize,
  type BadgeVariant,
  badgeTriggerClasses,
  cn,
} from '@ui';
import { usePropertiesContext } from '../context/PropertiesContext';

export function AddPropertyButton(props: {
  class?: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  onClick?: () => void;
}) {
  const { openPropertySelector } = usePropertiesContext();
  return (
    <button
      type="button"
      onClick={() => (props.onClick ?? openPropertySelector)()}
      class={badgeTriggerClasses({
        variant: props.variant ?? 'outline',
        size: props.size ?? 'sm',
        class: cn('gap-1', props.class),
      })}
    >
      <PlusIcon class="size-3 shrink-0" />
      <span>Add property</span>
    </button>
  );
}
