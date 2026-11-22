import { useViewShell, ViewSidebar } from '@app/components/view-shell';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { CalendarColorPicker } from '@app/features/calendar/components/calendar-color-picker';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useHasTeammates } from '@app/features/calendar/hooks/use-team-ooo';
import { TEAM_OOO_SOURCE_ID } from '@app/features/calendar/types';
import { groupCalendarSourcesByAccount } from '@app/features/calendar/utils/calendar-source-groups';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import {
  bookingLinksSearch,
  bookingLinksSearchCodec,
} from '@app/features/scheduling/booking-links-search';
import { useSchedulingProfileWithAutoSetupQuery } from '@app/features/scheduling/queries/source';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { bookingLinksRoute, calendarSettingsRoute } from '@app/routes/routes';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { touchHandler } from '@core/directive/touchHandler';
import { useAddInboxFlow } from '@core/email-link';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import BackIcon from '@icon/system/regular/caret-left.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, Checkbox } from '@ui';
import { batch, createSignal, For, Show } from 'solid-js';

const VIEWS = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'timeGridDay', label: 'Day' },
  { value: 'timeGridThreeDay', label: '3 days' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'dayGridMonth', label: 'Month' },
] as const;

function MobileBookingLinks() {
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
  const profile = () => (source.isSuccess ? source.data : undefined);
  const copy = async (slug: string) => {
    const owner = profile();
    if (!owner?.revision) return;
    const url = `${getWebOrigin()}/app/book/${encodeURIComponent(owner.id)}/${encodeURIComponent(slug)}`;
    if (await writeClipboardData({ 'text/plain': url }))
      toast.success('Booking link copied');
    else toast.failure('Could not copy booking link');
  };
  return (
    <section aria-label="Booking links" class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-3 text-[13px] font-medium text-ink-extra-muted">
        <span>Booking links</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New booking link"
          onClick={() =>
            fireAndForget(
              navigate(
                { route: bookingLinksRoute },
                {
                  search: {
                    [bookingLinksSearch.namespace]:
                      bookingLinksSearchCodec.serialize({
                        ...bookingLinksSearch.defaults,
                        createBookingLink: true,
                      }),
                  },
                }
              ),
              'calendar-booking-links'
            )
          }
        >
          <PlusIcon class="size-5" />
        </Button>
      </div>
      <Show when={source.isLoading}>
        <p role="status" class="px-3 text-sm text-ink-muted">
          Loading booking links…
        </p>
      </Show>
      <Show when={source.isError}>
        <Button
          variant="ghost"
          onClick={() =>
            fireAndForget(source.refetch(), 'calendar-booking-links')
          }
        >
          Retry booking links
        </Button>
      </Show>
      <For each={profile()?.eventTypes.filter((event) => event.enabled) ?? []}>
        {(event) => (
          <ViewSidebar.Item
            onClick={(e) => {
              e.preventDefault();
              fireAndForget(copy(event.slug), 'calendar-booking-copy');
            }}
          >
            <span class="min-w-0 flex-1 truncate">{event.title}</span>
            <CopyIcon class="size-5" />
          </ViewSidebar.Item>
        )}
      </For>
      <CopyAvailabilityButton
        class="w-full justify-start"
        size="lg"
        label="Copy availability"
      />
      <ViewSidebar.Item
        onClick={() =>
          fireAndForget(
            navigate({ route: bookingLinksRoute }),
            'calendar-booking-links'
          )
        }
      >
        Manage booking links
      </ViewSidebar.Item>
    </section>
  );
}

/** Calendar navigation is hosted by the shell's NavigationSheet, never its own drawer. */
export function MobileCalendarSidebar() {
  const view = useCalendarView();
  const navigation = useCalendarNavigation();
  const hasTeammates = useHasTeammates();
  const changeVisibility = (id: string, visible: boolean) => {
    view.closeEventDetails();
    view.setSourceVisibility(id, visible);
  };
  const shell = useViewShell();
  const navigate = useNavigate();
  const connect = useAddInboxFlow();
  const [preferences, setPreferences] = useCalendarPreferences();
  const [scroll, setScroll] = createSignal<HTMLDivElement>();
  const [selectedId, setSelectedId] = createSignal<string>();
  const selected = () =>
    view.sources().find((source) => source.id === selectedId());
  const groups = () =>
    groupCalendarSourcesByAccount(
      view.sources().filter((source) => source.emailLinkId)
    );
  return (
    <ViewSidebar.Root aria-label="Calendar navigation" class="bg-menu">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>Calendar</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <div class="relative flex min-h-0 flex-1 flex-col">
        <ViewSidebar.Content ref={setScroll} class="gap-5 pt-0 pb-4">
          <Show
            when={selected()}
            fallback={
              <>
                <ViewSidebar.Nav aria-label="Calendar views">
                  <For each={VIEWS}>
                    {(item) => (
                      <ViewSidebar.Item
                        active={navigation.periodView() === item.value}
                        onClick={() => navigation.changeView(item.value)}
                      >
                        {item.label}
                      </ViewSidebar.Item>
                    )}
                  </For>
                </ViewSidebar.Nav>
                <section aria-label="Calendars" class="flex flex-col gap-2">
                  <div class="flex items-center justify-between px-3 text-[13px] font-medium text-ink-extra-muted">
                    <span>Calendars</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Connect a calendar account"
                      onClick={() =>
                        fireAndForget(
                          connect({ scopes: 'gmail_and_calendar' }),
                          'calendar-connect'
                        )
                      }
                    >
                      <PlusIcon class="size-5" />
                    </Button>
                  </div>
                  <For each={groups()}>
                    {(group) => (
                      <div class="flex flex-col gap-1">
                        <div class="truncate px-3 py-2 text-[13px] text-ink-extra-muted">
                          {group.emailAddress}
                        </div>
                        <For each={group.calendars}>
                          {(source) => (
                            <div
                              ref={(element) =>
                                touchHandler(element, () => ({
                                  onLongPress: () => setSelectedId(source.id),
                                }))
                              }
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setSelectedId(source.id);
                              }}
                            >
                              <Checkbox
                                size="lg"
                                checked={view.isSourceVisible(source.id)}
                                onChange={(checked) =>
                                  changeVisibility(source.id, checked)
                                }
                                class="flex min-h-11 w-full gap-3 rounded-lg px-3 text-base"
                                style={{ '--color-accent': source.color }}
                              >
                                <Checkbox.Control />
                                <Checkbox.Label class="min-w-0 flex-1 truncate">
                                  {source.name}
                                </Checkbox.Label>
                              </Checkbox>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </section>
                <ShowFeatureFlag flag={enableCalendarTeamOoo}>
                  <Show when={hasTeammates()}>
                    <section aria-label="Team">
                      <div class="px-3 text-[13px] text-ink-extra-muted">
                        Team
                      </div>
                      <Checkbox
                        checked={view.isSourceVisible(TEAM_OOO_SOURCE_ID)}
                        onChange={(checked) =>
                          changeVisibility(TEAM_OOO_SOURCE_ID, checked)
                        }
                        class="flex min-h-11 gap-3 px-3"
                      >
                        <Checkbox.Control />
                        <Checkbox.Label>Out of office</Checkbox.Label>
                      </Checkbox>
                    </section>
                  </Show>
                </ShowFeatureFlag>
                <MobileBookingLinks />
              </>
            }
          >
            {(source) => (
              <section
                class="flex flex-col gap-3"
                aria-label="Calendar options"
              >
                <ViewSidebar.Item
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedId(undefined);
                  }}
                >
                  <BackIcon class="size-5" />
                  Back
                </ViewSidebar.Item>
                <h2 class="px-3 text-base font-medium">{source().name}</h2>
                <div class="flex items-center justify-between px-3">
                  <span>Calendar color</span>
                  <CalendarColorPicker
                    label={`${source().name} color`}
                    color={source().color}
                    overridden={
                      preferences.sourceColors[source().id] !== undefined
                    }
                    onChange={(color) =>
                      setPreferences('sourceColors', source().id, color)
                    }
                  />
                </div>
                <ViewSidebar.Item
                  onClick={(event) => {
                    event.preventDefault();
                    view.closeEventDetails();
                    batch(() => {
                      view.setSourcesVisibility(
                        view.sources().map((item) => item.id),
                        false
                      );
                      view.setSourceVisibility(source().id, true);
                    });
                    setSelectedId(undefined);
                  }}
                >
                  Show only this calendar
                </ViewSidebar.Item>
              </section>
            )}
          </Show>
        </ViewSidebar.Content>
        <ScrollIndicators
          scrollRef={scroll}
          appearance="gradient"
          gradientColor="menu"
          falloff="mobile"
        />
      </div>
      <div class="shrink-0 pb-2 pt-2" data-calendar-settings-footer>
        <MobileDrawer.Section class="mx-2">
          <ViewSidebar.Item
            class="rounded-[20px]"
            onClick={() => {
              shell.aside.collapse();
              fireAndForget(
                navigate({ route: calendarSettingsRoute }),
                'calendar-settings'
              );
            }}
          >
            <ViewSidebar.Icon>
              <GearIcon class="size-5" />
            </ViewSidebar.Icon>
            Settings
          </ViewSidebar.Item>
        </MobileDrawer.Section>
      </div>
    </ViewSidebar.Root>
  );
}
