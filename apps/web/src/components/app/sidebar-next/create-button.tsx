import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@phosphor/plus.svg';
import { Button, type ButtonProps } from '@ui';

/** An inset launcher tile, distinct from the navigation and search actions. */
const RailCreateTrigger = (props: ButtonProps) => (
  <Button
    {...props}
    variant="cta"
    class="rounded-full"
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
