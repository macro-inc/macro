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
            size={props.size ?? 'sm'}
            class={props.class}
            label={props.label}
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
            aria-label="New event or call"
          />
        )}
      </Show>
      <Dropdown.Content class={props.contentClass ?? 'min-w-40'}>
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
