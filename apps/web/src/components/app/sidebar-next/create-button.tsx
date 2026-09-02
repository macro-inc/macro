import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@phosphor/plus.svg';
import { Button, type ButtonProps } from '@ui';

/**
 * The rail's create trigger, as a CTA.
 *
 * The app's canonical `cta` Button: this is the one control in the rail meant
 * to pull the eye, and the accent fill along with its hover/active scrims,
 * focus ring and contrast tokens is already themed there. Only the geometry is
 * overridden, to sit in the rail's 36px column beside the search button.
 *
 * Kobalte's trigger props arrive via `as` and are spread on, so the ref and
 * handlers land on the real element. `variant`/`size` deliberately follow that
 * spread: `Dropdown.Trigger` blanks both for a custom trigger.
 */
const RailCreateTrigger = (props: ButtonProps) => (
  <Button
    {...props}
    variant="cta"
    class="rounded-full"
    size="icon-md"
    // class="rounded-full shadow-md shadow-drop-shadow bg-surface-2"
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
