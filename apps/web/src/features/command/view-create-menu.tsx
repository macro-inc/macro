import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import type { ButtonProps } from '@ui';
import { SidebarCreateMenu } from './sidebar/sidebar-create-menu';

/** General creation menu for views without their own creation workflow. */
export function ViewCreateMenu(props: { presentation: 'sidebar' | 'toolbar' }) {
  return (
    <SidebarCreateMenu
      placement={
        props.presentation === 'sidebar' ? 'bottom-start' : 'bottom-end'
      }
      trigger={(triggerProps: ButtonProps) => (
        <ViewCreateButton
          {...triggerProps}
          presentation={props.presentation}
          aria-label="New"
          menu
        />
      )}
    />
  );
}
