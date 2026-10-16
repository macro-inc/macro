import {
  createMenuOpen,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { APP_TOUR } from '@app/features/command/sidebar/tour';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';

/** The rail and keyboard shortcut open the same desktop launcher. */
export const SidebarRailCreateButton = () => {
  const analytics = useAnalytics();
  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  return (
    <Button
      ref={createMenuTarget}
      variant="ghost"
      class="size-10 [&_svg]:size-5"
      size="icon-md"
      label="Create"
      tooltipPlacement="right"
      hotkey={TOKENS.global.createCommand}
      aria-haspopup="dialog"
      aria-expanded={createMenuOpen()}
      onClick={() => {
        if (!createMenuOpen())
          analytics.track('create_menu_open', { from: 'sidebar' });
        setCreateMenuOpen((open) => !open);
      }}
    >
      <PlusIcon class="size-5" />
    </Button>
  );
};
