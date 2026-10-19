import { ViewSidebar } from '@app/components/view-shell';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { bookingLinksRoute } from '@app/routes/routes';
import { toast } from '@core/component/Toast/Toast';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import LinkIcon from '@phosphor/link.svg';
import { Dropdown } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import type { EventType } from './core/types';
import { useSchedulingProfileWithAutoSetupQuery } from './queries/source';

function Actions(props: { sidebar?: boolean }) {
  const user = useUserId();
  const navigate = useNavigate();
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
      fireAndForget(navigate({ route: bookingLinksRoute }), 'scheduling');
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
    <Dropdown placement={props.sidebar ? 'bottom-start' : 'bottom-end'}>
      <Dropdown.Trigger
        variant="ghost"
        size={props.sidebar ? 'md' : 'lg'}
        class={
          props.sidebar
            ? 'h-(--sidebar-row-height) w-full justify-start gap-(--sidebar-label-gap) rounded-lg px-(--sidebar-item-inset) text-left font-normal touch:h-11'
            : 'shrink-0 px-2 text-sm lg:px-3'
        }
        label="Booking links"
      >
        <Show
          when={props.sidebar}
          fallback={<LinkIcon class="size-5 mobile:size-6 lg:size-4" />}
        >
          <ViewSidebar.Icon>
            <LinkIcon />
          </ViewSidebar.Icon>
        </Show>
        <span
          class={props.sidebar ? 'min-w-0 flex-1 truncate' : 'hidden lg:inline'}
        >
          Booking links
        </span>
        <CaretDownIcon class="size-4 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class={
          props.sidebar
            ? 'w-[var(--kb-popper-anchor-width)] max-w-[calc(100vw-1rem)]'
            : 'min-w-48 max-w-[calc(100vw-1rem)]'
        }
      >
        <Dropdown.Group class="max-h-64 overflow-y-auto">
          <Show
            when={enabledLinks().length > 0}
            fallback={
              <p class="px-2 py-1.5 text-ink-muted">
                {source.isPending
                  ? 'Loading booking links…'
                  : 'No active booking links'}
              </p>
            }
          >
            <For each={enabledLinks()}>
              {(event) => (
                <Dropdown.Item
                  onSelect={() => fireAndForget(copyLink(event), 'scheduling')}
                >
                  <span class="min-w-0 truncate">{event.title}</span>
                </Dropdown.Item>
              )}
            </For>
          </Show>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() => navigate({ route: bookingLinksRoute })}
          >
            <ArrowSquareOutIcon class="size-4 shrink-0" />
            Manage booking links
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
