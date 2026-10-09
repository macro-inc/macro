import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { VIEW_TAB_PRESETS } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useSoup } from '@app/features/next-soup/soup-context';
import { SoupSearchbar } from '@app/features/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { VIEW_TAB_LISTS } from '@app/features/next-soup/soup-view/tab-lists';
import { usePreference } from '@app/preferences/use-preference';
import BuildingsIcon from '@phosphor/buildings.svg';
import GlobeIcon from '@phosphor/globe.svg';
import HashIcon from '@phosphor/hash.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PhoneSlashIcon from '@phosphor/phone-slash.svg';
import PhoneXIcon from '@phosphor/phone-x.svg';
import {
  SidebarTagsSection,
  selectSidebarTag,
} from '@property/tags/SidebarTagsSection';
import { Layer } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  CALL_AUDIENCES,
  type CallAudienceId,
  type CallChannelOption,
  callViewLabel,
  collectCallChannels,
  selectCallAudience,
} from '../core/call-filters';

type IconComponent = Component<{ class?: string }>;

const TAB_ICONS: Record<string, IconComponent> = {
  all: PhoneIcon,
  missed: PhoneXIcon,
  unattended: PhoneSlashIcon,
};

const AUDIENCE_ICONS: Record<CallAudienceId, IconComponent> = {
  'call-internal': BuildingsIcon,
  'call-external': GlobeIcon,
};

const MIN_FILTERED_CALLS = 30;

type SectionId = 'type' | 'channels' | 'tags';

function Row(props: {
  active: boolean;
  icon: IconComponent;
  label: string;
  onClick: () => void;
}) {
  return (
    <ViewSidebar.Item
      active={props.active}
      title={props.label}
      onClick={props.onClick}
    >
      <ViewSidebar.Icon>
        <Dynamic component={props.icon} class="size-4" />
      </ViewSidebar.Icon>
      <span class="truncate">{props.label}</span>
    </ViewSidebar.Item>
  );
}

function Section(props: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Trigger>
        <span class="min-w-0 truncate">{props.title}</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <CollapsibleSection.Content>
        <ViewSidebar.Nav aria-label={props.title}>
          {props.children}
        </ViewSidebar.Nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

/** Views, audience, channel, and tag navigation for the Calls list. */
export function CallsSidebar() {
  const soup = useSoup();
  const view = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const [collapsed, setCollapsed] = usePreference<SectionId[]>(
    'macro:pref:calls:sidebar-collapsed',
    { default: [] }
  );
  const isOpen = (id: SectionId) => !collapsed().includes(id);
  const setOpen = (id: SectionId, open: boolean) =>
    setCollapsed((ids) =>
      open ? ids.filter((value) => value !== id) : [...ids, id]
    );

  const activeTab = () => view.activeTab() ?? VIEW_TAB_PRESETS.calls.default;

  const selectAudience = (id: CallAudienceId) =>
    soup.predicates.set(({ andIds, orIds }) => ({
      and: selectCallAudience(andIds, id),
      or: orIds,
    }));

  // Audience filters only narrow loaded pages, and a sparse page leaves no
  // list to scroll, so keep paging until enough matches show or pages run out.
  createEffect(() => {
    const audienceActive = CALL_AUDIENCES.some((a) =>
      soup.predicates.isActive(a.id)
    );
    if (
      audienceActive &&
      view.items().length < MIN_FILTERED_CALLS &&
      view.source.hasNextPage() &&
      !view.source.isFetching()
    ) {
      void view.source.fetchNextPage();
    }
  });

  const channels = createMemo<CallChannelOption[]>(
    (known) => collectCallChannels(known, view.source.data()),
    []
  );
  const activeChannelIds = () =>
    view.queryFilters.state.include.callChannelId ?? [];
  const selectChannel = (id: string) =>
    view.queryFilters.set({
      include: { callChannelId: selectSidebarTag(activeChannelIds(), id) },
    });

  return (
    <ViewSidebar.Root aria-label="Calls navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>Calls</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <Layer depth={2}>
          <SoupSearchbar variant="secondary" placeholder="Search calls" />
        </Layer>
      </ViewSidebar.Primary>

      <ViewSidebar.Content>
        <ViewSidebar.Nav aria-label="Call views">
          <For each={VIEW_TAB_LISTS.calls}>
            {(tab) => (
              <Row
                active={activeTab() === tab.value}
                icon={TAB_ICONS[tab.value] ?? PhoneIcon}
                label={callViewLabel(tab)}
                onClick={() => applyTabPreset('calls', tab.value)}
              />
            )}
          </For>
        </ViewSidebar.Nav>

        <Section
          title="Type"
          open={isOpen('type')}
          onOpenChange={(open) => setOpen('type', open)}
        >
          <For each={CALL_AUDIENCES}>
            {(audience) => (
              <Row
                active={soup.predicates.isActive(audience.id)}
                icon={AUDIENCE_ICONS[audience.id]}
                label={audience.label}
                onClick={() => selectAudience(audience.id)}
              />
            )}
          </For>
        </Section>

        <Show when={channels().length > 0}>
          <Section
            title="Channels"
            open={isOpen('channels')}
            onOpenChange={(open) => setOpen('channels', open)}
          >
            <For each={channels()}>
              {(channel) => (
                <Row
                  active={activeChannelIds().includes(channel.id)}
                  icon={HashIcon}
                  label={channel.name}
                  onClick={() => selectChannel(channel.id)}
                />
              )}
            </For>
          </Section>
        </Show>

        <SidebarTagsSection
          activeIds={view.tagFilter.activeIds()}
          onActiveIdsChange={view.tagFilter.onChange}
          open={isOpen('tags')}
          onOpenChange={(open) => setOpen('tags', open)}
        />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
