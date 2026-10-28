import {
  RecipientSelector,
  type RecipientSelectorProps,
} from '@core/component/RecipientSelector';
import { cn } from '@ui';

/** Email recipient chips and address completion, independent of a compose session. */
export function ComposeRecipientInput(
  props: RecipientSelectorProps<'user' | 'contact' | 'custom'>
) {
  return (
    <RecipientSelector
      {...props}
      hideBorder
      noPadding
      openOnFocus={props.openOnFocus ?? false}
      hideMenuOnEscape
      class={cn('bg-transparent [&_input]:ml-0!', props.class)}
    />
  );
}
