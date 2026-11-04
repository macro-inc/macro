import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { type ButtonSize, Dropdown } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Menu presentation; consumers compose its trigger and creation items. */
export function CalendarCreateMenu(props: {
  trigger: JSX.Element;
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  size?: ButtonSize;
  label?: string;
  presentation?: 'sidebar' | 'toolbar';
}) {
  return (
    <Dropdown
      placement={
        props.presentation === 'toolbar' ? 'bottom-end' : 'bottom-start'
      }
    >
      <Show
        when={props.presentation}
        fallback={
          <Dropdown.Trigger
            aria-label={props.label}
            tooltip={props.label}
            size={props.size ?? 'sm'}
            class={props.class}
          >
            {props.trigger}
          </Dropdown.Trigger>
        }
      >
        {(presentation) => (
          <Dropdown.Trigger
            as={ViewCreateButton}
            presentation={presentation()}
            menu
            aria-label="New event, call, or booking link"
          />
        )}
      </Show>
      <Dropdown.Content
        class={props.contentClass ?? 'w-80 max-w-[calc(100vw-2rem)]'}
      >
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
