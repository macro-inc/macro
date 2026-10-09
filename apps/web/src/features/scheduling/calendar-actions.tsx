import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CaretDownIcon from '@phosphor/caret-down.svg';
import GearIcon from '@phosphor/gear.svg';
import LinkIcon from '@phosphor/link.svg';
import { Button } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import type { EventType } from './core/types';
import { useSchedulingProfileWithAutoSetupQuery } from './queries/source';

function Actions() {
  const user = useUserId();
  const settings = useSettingsState();
  const source = useSchedulingProfileWithAutoSetupQuery(
    () => ({
      id: user() ?? 'me',
      name: 'Personal',
      canEdit: true,
    }),
    () => user() ?? ''
  );

  const enabledLinks = () => {
    const profile = source.isSuccess ? source.data : undefined;
    if (!profile?.revision) return [];
    return profile.eventTypes.filter((e) => e.enabled);
  };

  const copyLink = async (event?: EventType) => {
    const profile = source.isSuccess ? source.data : undefined;
    if (!profile?.revision) {
      settings.openSettings('Booking links');
      return;
    }

    const slug = event?.slug;
    const url = slug
      ? `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}/${encodeURIComponent(slug)}`
      : `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}`;

    if (await writeClipboardData({ 'text/plain': url }))
      toast.success('Booking link copied');
    else toast.failure('Could not copy booking link');
  };

  const handleClick = async () => {
    const links = enabledLinks();
    if (links.length === 0) {
      settings.openSettings('Booking links');
    } else if (links.length === 1) {
      await copyLink(links[0]);
    }
  };

  return (
    <div class="flex shrink-0 items-center gap-1">
      <Show
        when={enabledLinks().length > 1}
        fallback={
          <Button
            variant="ghost"
            size="sm"
            label="Copy booking link"
            disabled={source.isPending}
            onClick={() => void handleClick()}
          >
            <LinkIcon class="size-3.5" />
            <span class="hidden lg:inline">Booking link</span>
          </Button>
        }
      >
        <DropdownMenu>
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            size="sm"
            label="Copy booking link"
            disabled={source.isPending}
          >
            <LinkIcon class="size-3.5" />
            <span class="hidden lg:inline">Booking link</span>
            <CaretDownIcon class="size-3" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="z-action-menu min-w-48 rounded-xl border border-edge-muted bg-menu p-1 text-sm shadow-lg">
              <For each={enabledLinks()}>
                {(event) => (
                  <DropdownMenu.Item
                    class="rounded-lg px-3 py-2 outline-none data-highlighted:bg-hover"
                    onSelect={() => void copyLink(event)}
                  >
                    {event.title}
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Open booking link settings"
        onClick={() => settings.openSettings('Booking links')}
      >
        <GearIcon class="size-3.5" />
      </Button>
    </div>
  );
}
export function CalendarSchedulingActions() {
  return (
    <ShowFeatureFlag flag={enableCalendarScheduling}>
      <Suspense>
        <Actions />
      </Suspense>
    </ShowFeatureFlag>
  );
}
