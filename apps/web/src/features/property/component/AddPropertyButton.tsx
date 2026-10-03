import PlusIcon from '@phosphor/plus.svg';
import { badgeTriggerClasses } from '@ui';
import { usePropertiesContext } from '../context/PropertiesContext';

export function AddPropertyButton(props: { class?: string }) {
  const { openPropertySelector } = usePropertiesContext();
  return (
    <button
      type="button"
      onClick={openPropertySelector}
      class={badgeTriggerClasses({
        variant: 'outline',
        size: 'sm',
        class: props.class,
      })}
    >
      <PlusIcon class="size-3 shrink-0" />
      <span>Add property</span>
    </button>
  );
}
