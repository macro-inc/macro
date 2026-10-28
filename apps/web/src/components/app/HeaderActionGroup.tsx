import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ButtonGroup, useButtonGroupContext } from '@ui/components/ButtonGroup';
import { cn } from '@ui/utils/classname';
import { type ParentProps, Show } from 'solid-js';

/**
 * A desktop header island: related actions share the secondary raised frame.
 * Their segments stay flat. Touch renders actions without a frame, and a
 * nested group reuses its parent's frame. An island with no actions renders
 * nothing, so conditional children need no wrapper.
 *
 * @do Group actions by meaning: filters, view options, sharing, navigation, detail toggles.
 * @do Use `size="icon-sm"` for icon-only actions; labelled segments inherit `sm`.
 * @do Mark on/off toggles with `aria-pressed`; the pressed fill matches a selected tab.
 * @dont Do not put Tabs, TabSelector, or Buttons acting as tabs in an island.
 * @dont Do not add borders, shadows, or backgrounds to the buttons inside.
 */
export function HeaderActionGroup(
  props: ParentProps<{ label: string; class?: string; size?: 'sm' | 'md' }>
) {
  const group = useButtonGroupContext();
  return (
    <Show when={!isTouchDevice() && !group} fallback={props.children}>
      <ButtonGroup
        aria-label={props.label}
        variant="secondary"
        finish="raised"
        size={props.size ?? 'sm'}
        class={cn(
          'hidden shrink-0 border-0 has-[[data-button]]:inline-flex',
          props.size === 'md' ? 'min-h-8' : 'min-h-7',
          props.class
        )}
      >
        {props.children}
      </ButtonGroup>
    </Show>
  );
}
