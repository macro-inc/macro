import { Combobox, useComboboxContext } from '@kobalte/core/combobox';
import type { ComponentProps } from 'solid-js';

/** Kobalte's default dismissal schedules a second close. It can arrive after
 * the user refocuses and types a new query, cancelling the new window. */
export function RecipientMenuContent(
  props: ComponentProps<typeof Combobox.Content>
) {
  const context = useComboboxContext();
  return (
    <Combobox.Content
      {...props}
      onInteractOutside={(event) => {
        props.onInteractOutside?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        context.resetInputValue(
          context.listState().selectionManager().selectedKeys()
        );
        context.close();
      }}
    />
  );
}
