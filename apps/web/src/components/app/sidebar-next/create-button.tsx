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
  const logoUrl = () => {
    const id = logoFileId();
    if (!id || !dockShowsTeamLogo() || failedLogo() === id) return undefined;
    return staticFileSizedEndpoint(id, 'small');
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
      class="size-(--rail-button-size)"
      size="icon-md"
      aria-haspopup="dialog"
      aria-expanded={createMenuOpen()}
      onClick={() => {
        if (!createMenuOpen())
          analytics.track('create_menu_open', { from: 'sidebar' });
        setCreateMenuOpen((open) => !open);
      }}
    >
      <Show
        when={logoUrl()}
        fallback={<PlusIcon class="size-(--rail-icon-size)" />}
      >
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            class="pointer-events-none size-[calc(var(--rail-button-size)-0.5rem)] rounded-md object-contain"
            onError={() => setFailedLogo(logoFileId())}
          />
        )}
      </Show>
    </Button>
  );
};
