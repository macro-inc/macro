import { useViewShell, ViewSidebar } from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import { CalendarSwatch } from '@app/features/calendar/components/CalendarSwatch';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { CalendarColorPicker } from '@app/features/calendar/components/calendar-color-picker';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useHasTeammates } from '@app/features/calendar/hooks/use-team-ooo';
import { TEAM_OOO_SOURCE_ID } from '@app/features/calendar/types';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { groupCalendarSourcesByAccount } from '@app/features/calendar/utils/calendar-source-groups';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { copyBookingLink } from '@app/features/scheduling/booking-link';
import {
  bookingLinksSearch,
  bookingLinksSearchCodec,
} from '@app/features/scheduling/booking-links-search';
import { useSchedulingProfileWithAutoSetupQuery } from '@app/features/scheduling/queries/source';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { bookingLinksRoute, calendarSettingsRoute } from '@app/routes/routes';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { touchHandler } from '@core/directive/touchHandler';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import BackIcon from '@icon/system/regular/caret-left.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, Checkbox } from '@ui';
import { batch, createSignal, For, Show } from 'solid-js';

const VIEWS = [
  'agenda',
  'timeGridDay',
  'timeGridThreeDay',
  'timeGridWeek',
  'dayGridMonth',
] as const;

function MobileBookingLinks() {
  const user = useUserId();
  const navigate = useNavigate();
  const source = useSchedulingProfileWithAutoSetupQuery(
    () => ({
      id: user() ?? 'me',
      name: t('viewMenus.personal'),
      canEdit: true,
      canManageBookings: true,
    }),
    () => user() ?? ''
  );
  const profile = () => (source.isSuccess ? source.data : undefined);
  const copy = async (slug: string) => {
    const owner = profile();
    if (!owner?.revision) return;
    await copyBookingLink(owner, slug);
  };
  return (
    <section
      aria-label={t('calendar.bookingLinks')}
      class="flex flex-col gap-2"
    >
      <div class="flex items-center justify-between px-3 text-xs font-medium text-ink-extra-muted">
        <span>{t('calendar.bookingLinks')}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calendar.newBookingLink')}
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
        <ListSkeleton.Root
          class="px-3"
          label={t('calendar.loadingBookingLinks')}
        >
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-4 w-32" />
          </ListSkeleton.Row>
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-4 w-40" />
          </ListSkeleton.Row>
        </ListSkeleton.Root>
      </Show>
      <Show when={source.isError}>
        <Button
          variant="ghost"
          onClick={() =>
            fireAndForget(source.refetch(), 'calendar-booking-links')
          }
        >
          {t('calendar.retryBookingLinks')}
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
        label={t('calendar.copyAvailability')}
      />
      <ViewSidebar.Item
        onClick={() =>
          fireAndForget(
            navigate({ route: bookingLinksRoute }),
            'calendar-booking-links'
          )
        }
      >
        {t('calendar.manageBookingLinks')}
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
    <ViewSidebar.Root aria-label={t('calendar.navigation')} class="bg-menu">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>
            {t('calendar.composerCalendar')}
          </ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <div class="relative flex min-h-0 flex-1 flex-col">
        <ViewSidebar.Content ref={setScroll} class="gap-5 pt-0 pb-4">
          <Show
            when={selected()}
            fallback={
              <>
                <ViewSidebar.Nav aria-label={t('calendar.views')}>
                  <For each={VIEWS}>
                    {(item) => (
                      <ViewSidebar.Item
                        active={navigation.periodView() === item}
                        onClick={() => navigation.changeView(item)}
                      >
                        {calendarPeriodLabel(item)}
                      </ViewSidebar.Item>
                    )}
                  </For>
                </ViewSidebar.Nav>
                <section
                  aria-label={t('calendar.calendars')}
                  class="flex flex-col gap-2"
                >
                  <div class="flex items-center justify-between px-3 text-xs font-medium text-ink-extra-muted">
                    <span>{t('calendar.calendars')}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('calendar.connectAccount')}
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
                        <div class="truncate px-3 py-2 text-xs text-ink-extra-muted">
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
                              >
                                <Checkbox.Control />
                                <CalendarSwatch color={source.color} />
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
                    <section aria-label={t('calendar.team')}>
                      <div class="px-3 text-xs text-ink-extra-muted">
                        {t('calendar.team')}
                      </div>
                      <Checkbox
                        checked={view.isSourceVisible(TEAM_OOO_SOURCE_ID)}
                        onChange={(checked) =>
                          changeVisibility(TEAM_OOO_SOURCE_ID, checked)
                        }
                        class="flex min-h-11 gap-3 px-3"
                      >
                        <Checkbox.Control />
                        <Checkbox.Label>
                          {t('calendar.eventKindOutOfOffice')}
                        </Checkbox.Label>
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
                aria-label={t('calendar.options')}
              >
                <ViewSidebar.Item
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedId(undefined);
                  }}
                >
                  <BackIcon class="size-5" />
                  {t('common.back')}
                </ViewSidebar.Item>
                <h2 class="px-3 text-base font-medium">{source().name}</h2>
                <div class="flex items-center justify-between px-3">
                  <span>{t('calendar.color')}</span>
                  <CalendarColorPicker
                    label={t('calendar.namedColor', { name: source().name })}
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
                  {t('calendar.showOnly')}
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
      <div class="shrink-0 p-2" data-calendar-settings-footer>
        <MobileDrawer.Section>
          <ViewSidebar.Item
            class="rounded-3xl"
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
            {t('common.settings')}
          </ViewSidebar.Item>
        </MobileDrawer.Section>
      </div>
    </ViewSidebar.Root>
  );
}
