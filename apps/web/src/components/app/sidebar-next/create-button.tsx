import {
  createMenuOpen,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { APP_TOUR } from '@app/features/command/sidebar/tour';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';

/** The rail and keyboard shortcut open the same desktop launcher. */
export const SidebarRailCreateButton = () => {
  const analytics = useAnalytics();
  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  return (
    <Button
      aria-label={t('nav.create')}
      tooltip={{
        content: t('nav.create'),
        placement: 'right',
        hotkey: TOKENS.global.createCommand,
      }}
      ref={createMenuTarget}
      variant="ghost"
      class="size-10"
      size="icon-md"
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

/** The single sidebar's labelled New, opening the same launcher. */
export const SidebarNewButton = () => {
  const analytics = useAnalytics();
  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  return (
    <Button
      ref={createMenuTarget}
      variant="secondary"
      size="md"
      class="shrink-0"
      tooltip={{
        content: t('nav.create'),
        hotkey: TOKENS.global.createCommand,
      }}
      aria-haspopup="dialog"
      aria-expanded={createMenuOpen()}
      onClick={() => {
        if (!createMenuOpen())
          analytics.track('create_menu_open', { from: 'sidebar' });
        setCreateMenuOpen((open) => !open);
      }}
    >
      <PlusIcon class="size-4" />
      {t('nav.new')}
    </Button>
  );
};
