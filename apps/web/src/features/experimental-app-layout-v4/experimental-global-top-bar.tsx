import { CommandState } from '@app/features/command';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useSettingsState } from '@core/constant/SettingsState';
import { staticFileSizedUrl } from '@core/constant/servers';
import { useUserContext } from '@core/context/user';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import WideSearchIcon from '@icon/wide-search.svg';
import CommandIcon from '@phosphor/command.svg';
import GearIcon from '@phosphor/gear.svg';
import { Avatar, Button, Tooltip } from '@ui';
import { Show } from 'solid-js';

function userInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

function CurrentUserAvatar(props: { id: string; label: string }) {
  const [profilePictureUrl] = useProfilePictureUrl(props.id);

  return (
    <Avatar size="md" class="ring ring-edge-muted">
      <Show
        when={profilePictureUrl()}
        keyed
        fallback={
          <Avatar.Fallback class="font-semibold">
            {userInitials(props.label)}
          </Avatar.Fallback>
        }
      >
        {(url) => (
          <Avatar.Image
            src={staticFileSizedUrl(url, 'small')}
            alt={props.label}
            class="bg-surface"
            onError={(event) => {
              if (event.currentTarget.src !== url) {
                event.currentTarget.src = url;
              }
            }}
          />
        )}
      </Show>
    </Avatar>
  );
}

/** Full-width global chrome used only by Experimental v4. */
export function ExperimentalGlobalTopBar() {
  const analytics = useAnalytics();
  const { openSettings } = useSettingsState();
  const user = useUserContext();

  const openSearch = () => {
    analytics.track('sidebar_click', { view: 'search' });
    analytics.track('command_menu_open', { from: 'global_topbar_search' });
    CommandState.open();
  };
  const openCommandMenu = () => {
    analytics.track('command_menu_open', { from: 'global_topbar' });
    CommandState.open();
  };

  return (
    <header class="flex shrink-0 items-center bg-page py-2 pr-2">
      <div class="flex-1" />

      <div class="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted [&_svg]:size-4!"
          label="Search"
          tooltipPlacement="bottom"
          aria-label="Search"
          onClick={openSearch}
        >
          <WideSearchIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted"
          label="Command menu"
          tooltipPlacement="bottom"
          aria-label="Command menu"
          onClick={openCommandMenu}
        >
          <CommandIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted"
          label="Settings"
          tooltipPlacement="bottom"
          aria-label="Settings"
          onClick={() => openSettings('Account')}
        >
          <GearIcon />
        </Button>
        <Tooltip label={user.author()} placement="bottom">
          <button
            type="button"
            class="ml-1 flex size-8 items-center justify-center rounded-lg outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`Open account settings for ${user.author()}`}
            onClick={() => openSettings('Account')}
          >
            <Show
              when={user.userId()}
              keyed
              fallback={
                <Avatar size="md" class="ring ring-edge-muted">
                  <Avatar.Fallback class="font-semibold">
                    {userInitials(user.author())}
                  </Avatar.Fallback>
                </Avatar>
              }
            >
              {(id) => <CurrentUserAvatar id={id} label={user.author()} />}
            </Show>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
