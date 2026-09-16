import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@phosphor/plus.svg';
import { Button, type ButtonProps } from '@ui';

/** The rail's monochrome create trigger, with themed hover and press feedback.
 * Kobalte forwards its trigger ref and handlers through the custom component.
 */
const RailCreateTrigger = (props: ButtonProps) => (
  <Button
    {...props}
    variant="strong"
    class="rounded-full bg-ink-muted"
    size="icon-md"
    label="Create"
    tooltipPlacement="right"
    hotkey={TOKENS.global.createCommand}
  >
    <PlusIcon class="size-5" />
  </Button>
);

export const SidebarRailCreateButton = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => (
  <SidebarCreateMenu
    trigger={RailCreateTrigger}
    onMenuOpenChange={props.onMenuOpenChange}
  />
);
