import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ButtonGroup, useButtonGroupContext } from '@ui/components/ButtonGroup';
import { cn } from '@ui/utils/classname';
import { type ParentProps, Show } from 'solid-js';

/**
 * A desktop header island: related actions share one elevated frame and
 * their buttons stay flat. Touch renders the actions without a frame, and a
 * nested group reuses its parent's frame. An island with no actions renders
 * nothing, so conditional children need no wrapper.
 *
 * @do Group actions by meaning: filters, view options, sharing, navigation, detail toggles.
 * @do Use `size="icon-md"` for icon-only actions and `size="md"` for labelled ones.
 * @do Mark on/off toggles with `aria-pressed`; the pressed fill matches a selected tab.
 * @dont Do not put Tabs, TabSelector, or Buttons acting as tabs in an island.
 * @dont Do not add borders, shadows, or backgrounds to the buttons inside.
 */
export function HeaderActionGroup(
  props: ParentProps<{ label: string; class?: string }>
) {
  const group = useButtonGroupContext();
  return (
    <Show when={!isTouchDevice() && !group} fallback={props.children}>
      <ButtonGroup
        label={props.label}
        variant="outline"
        size="md"
        class={cn(
          'hidden h-8 shrink-0 has-[[data-button]]:inline-flex',
          props.class
        )}
      >
        {props.children}
      </ButtonGroup>
    </Show>
  );
}
