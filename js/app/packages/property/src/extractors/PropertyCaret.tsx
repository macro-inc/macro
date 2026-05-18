import CaretDownIcon from '@icon/caret-down.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useProperty } from '../core/context';

type Props = {
  class?: string;
};

/**
 * Caret-down affordance — hidden when the property is read-only.
 * Must be inside <Property.Root>.
 */
export function PropertyCaret(props: Props) {
  const ctx = useProperty();
  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;

  return (
    <Show when={!isReadOnly()}>
      <CaretDownIcon class={cn('size-3 shrink-0', props.class)} />
    </Show>
  );
}
