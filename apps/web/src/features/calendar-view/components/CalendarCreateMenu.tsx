import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { Dropdown } from '@ui';
import type { JSX } from 'solid-js';

/** Menu presentation; consumers supply creation actions. */
export function CalendarCreateMenu(props: {
  children: JSX.Element;
  presentation: 'sidebar' | 'toolbar';
  restoreFocus?: boolean;
}) {
  return (
    <Dropdown
      modal={false}
      placement={
        props.presentation === 'toolbar' ? 'bottom-end' : 'bottom-start'
      }
    >
      <Dropdown.Trigger
        as={ViewCreateButton}
        presentation={props.presentation}
        menu
        aria-label="New event, call, or booking link"
      />
      <Dropdown.Content
        class="w-80 max-w-[calc(100vw-2rem)]"
        onCloseAutoFocus={(event) => {
          if (props.restoreFocus === false) event.preventDefault();
        }}
      >
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
