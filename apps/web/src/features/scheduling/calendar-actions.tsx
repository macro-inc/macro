import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { cn, Dropdown } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import type { EventType } from './core/types';
import { useSchedulingProfileWithAutoSetupQuery } from './queries/source';

function Actions(props: { sidebar?: boolean }) {
  const user = useUserId();
  const settings = useSettingsState();
  const source = useSchedulingProfileWithAutoSetupQuery(
    () => ({
      id: user() ?? 'me',
      name: 'Personal',
      canEdit: true,
      canManageBookings: true,
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

  return (
    <Dropdown placement={props.sidebar ? 'top-start' : 'bottom-end'}>
      <Dropdown.Trigger
        variant="ghost"
        size="md"
        label="Booking links"
        class={cn(
          'h-8 shrink-0 rounded-lg text-sm',
          props.sidebar ? 'w-full justify-start gap-2 px-2' : 'w-8 px-0'
        )}
      >
        <LinkIcon class="size-4 shrink-0" />
        <Show when={props.sidebar}>
          <span class="min-w-0 flex-1 text-left">Booking links</span>
          <CaretDownIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-56">
        <Show when={enabledLinks().length > 0}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Copy a booking link</Dropdown.GroupLabel>
            <For each={enabledLinks()}>
              {(event) => (
                <Dropdown.Item onSelect={() => void copyLink(event)}>
                  <LinkIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="min-w-0 flex-1 truncate">{event.title}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() => settings.openSettings('Booking links')}
          >
            <GearIcon class="size-4 shrink-0 text-ink-muted" />
            <span>Manage booking links</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
export function CalendarSchedulingActions(props: { sidebar?: boolean }) {
  return (
    <ShowFeatureFlag flag={enableCalendarScheduling}>
      <Suspense>
        <Actions sidebar={props.sidebar} />
      </Suspense>
    </ShowFeatureFlag>
  );
}
