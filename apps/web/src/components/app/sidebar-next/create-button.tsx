import {
  createMenuOpen,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { APP_TOUR } from '@app/features/command/sidebar/tour';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { staticFileSizedEndpoint } from '@core/constant/servers';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@icon/system/regular/plus.svg';
import { useCurrentTeamLogoFileId } from '@queries/team/teams';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, Show } from 'solid-js';
import { dockPopoverPlacement, dockShowsTeamLogo } from '../dock-prefs';

/**
 * The rail and keyboard shortcut open the same desktop launcher. The button
 * shows the team's logo in place of + when the team has one, unless the user
 * turned it off in Settings → Dock.
 */
export const SidebarRailCreateButton = () => {
  const analytics = useAnalytics();
  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  const logoFileId = useCurrentTeamLogoFileId();
  // Keyed by file id, so a new logo gets another chance after a failed load.
  const [failedLogo, setFailedLogo] = createSignal<string>();
  const shownLogo = () => {
    const id = logoFileId();
    if (!id || !dockShowsTeamLogo() || failedLogo() === id) return undefined;
    return id;
  };
  return (
    <Button
      aria-label={t('nav.create')}
      tooltip={{
        content: t('nav.create'),
        placement: dockPopoverPlacement(),
        hotkey: TOKENS.global.createCommand,
      }}
      ref={createMenuTarget}
      variant="ghost"
      class="size-(--rail-button-size) shrink-0"
      size="icon-md"
      aria-haspopup="dialog"
      aria-expanded={createMenuOpen()}
      onClick={() => {
        if (!createMenuOpen())
          analytics.track('create_menu_open', { from: 'sidebar' });
        setCreateMenuOpen((open) => !open);
      }}
    >
      {/* Keyed, so each image reports a failed load for its own file only,
          never for a logo that replaced it before the error arrived. */}
      <Show
        when={shownLogo()}
        keyed
        fallback={<PlusIcon class="size-(--rail-icon-size)" />}
      >
        {(id) => (
          <img
            src={staticFileSizedEndpoint(id, 'small')}
            alt=""
            draggable={false}
            class="pointer-events-none size-[calc(var(--rail-button-size)-0.5rem)] rounded-md object-contain"
            onError={() => setFailedLogo(id)}
          />
        )}
      </Show>
    </Button>
  );
};
