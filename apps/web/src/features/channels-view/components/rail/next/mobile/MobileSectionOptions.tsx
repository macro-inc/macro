import { MobileFilterDrawer } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { longPressActivated } from '@core/directive/touchHandler';
import { fireAndForget } from '@core/util/fireAndForget';
import { isMutedItem } from '@entity/utils/notification';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Accordion } from '@kobalte/core/accordion';
import { NotificationMuteOptions } from '@notifications/components/NotificationMuteMenu';
import { queryReadyGate } from '@queries/gate';
import { useMutedEntitiesQuery } from '@queries/notification/unsubscribes';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { ChannelSectionPreferences } from '../../../../types';

export function MobileSectionOptions(props: {
  label: ChannelLabel;
  teamName?: string;
  canShare: boolean;
  canEdit: boolean;
  canChangeScope: boolean;
  preferences: ChannelSectionPreferences;
  onPreferences: (preferences: ChannelSectionPreferences) => void;
  onScope: (shared: boolean) => Promise<void>;
  onEdit: () => Promise<void>;
  onAdd: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMute: (muted: boolean) => Promise<void>;
  onSnooze: (until?: Date) => Promise<void>;
  onMarkRead: () => Promise<void>;
  disabled?: boolean;
  onClose: () => void;
  editors?: JSX.Element;
}) {
  const [muteOpen, setMuteOpen] = createSignal(false);
  const muted = useMutedEntitiesQuery();
  const allMuted = () =>
    queryReadyGate(muted) &&
    props.label.channelIds.length > 0 &&
    props.label.channelIds.every((id) =>
      isMutedItem(muted.data ?? [], { item_type: 'channel', item_id: id })
    );
  const sorts = () => [
    { value: 'name' as const, label: t('channelSections.alphabetical') },
    { value: 'viewed_at' as const, label: t('channelSections.lastViewed') },
    { value: 'updated_at' as const, label: t('channelSections.lastUpdated') },
    { value: 'created_at' as const, label: t('channelSections.dateCreated') },
  ];
  return (
    <MobileDrawer
      open
      onOutsidePointer={(event) => {
        if (longPressActivated()) event.preventDefault();
      }}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content>
          <MobileDrawer.Handle />
          <div class="flex shrink-0 items-center gap-2 px-6 pb-3">
            <Show when={muteOpen()}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.back')}
                onClick={() => setMuteOpen(false)}
              >
                <ArrowLeftIcon class="size-4" />
              </Button>
            </Show>
            <MobileDrawer.Title class="min-w-0 flex-1 truncate text-lg font-semibold">
              {muteOpen()
                ? t('channelSections.muteAllChannels')
                : props.label.name}
            </MobileDrawer.Title>
            <Show when={!muteOpen()}>
              <Show when={props.label.teamId}>
                <UsersIcon class="size-4 shrink-0" />
              </Show>
              <Show when={props.label.rule}>
                <FunnelIcon class="size-4 shrink-0" />
              </Show>
            </Show>
          </div>
          <MobileDrawer.ScrollBody>
            <Show
              when={!muteOpen()}
              fallback={
                <MobileDrawer.Section>
                  <NotificationMuteOptions
                    disabled={props.disabled}
                    onMute={(muted) =>
                      fireAndForget(props.onMute(muted), 'channels-view')
                    }
                    onSnooze={(until) =>
                      fireAndForget(props.onSnooze(until), 'channels-view')
                    }
                  />
                </MobileDrawer.Section>
              }
            >
              <div class="flex flex-col gap-3">
                <Show when={props.canEdit}>
                  <MobileDrawer.Section>
                    <MobileDrawer.Item
                      disabled={props.disabled}
                      onClick={() =>
                        fireAndForget(props.onEdit(), 'channels-view')
                      }
                    >
                      <PencilIcon class="size-5" />
                      {t('channelSections.editSection')}
                    </MobileDrawer.Item>
                    <Show when={!props.label.rule}>
                      <MobileDrawer.Item
                        disabled={props.disabled}
                        onPointerDown={(event) => event.preventDefault()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          fireAndForget(props.onAdd(), 'channels-view')
                        }
                      >
                        <PlusIcon class="size-5" />
                        {t('channelSections.addChannels')}
                      </MobileDrawer.Item>
                    </Show>
                  </MobileDrawer.Section>
                </Show>
                <Accordion
                  multiple
                  collapsible
                  defaultValue={['sort', 'display']}
                >
                  <div class="flex flex-col gap-3">
                    <Show when={props.canEdit && props.canChangeScope}>
                      <MobileFilterDrawer.Section
                        value="visibility"
                        label={t('channelSections.visibleTo')}
                        activeCount={props.label.teamId ? 1 : 0}
                      >
                        <div
                          role="group"
                          aria-label={t('channelSections.visibleTo')}
                        >
                          <MobileFilterDrawer.Option
                            checked={!props.label.teamId}
                            disabled={props.disabled}
                            onChange={(checked) => {
                              if (checked)
                                fireAndForget(
                                  props.onScope(false),
                                  'channels-view'
                                );
                            }}
                          >
                            {t('channelSections.onlyMe')}
                          </MobileFilterDrawer.Option>
                          <Show when={props.canShare}>
                            <MobileFilterDrawer.Option
                              checked={Boolean(props.label.teamId)}
                              disabled={props.disabled}
                              onChange={(checked) => {
                                if (checked)
                                  fireAndForget(
                                    props.onScope(true),
                                    'channels-view'
                                  );
                              }}
                            >
                              {props.teamName ??
                                t('channelSections.team_channels')}
                            </MobileFilterDrawer.Option>
                          </Show>
                        </div>
                      </MobileFilterDrawer.Section>
                    </Show>
                    <MobileFilterDrawer.Section
                      value="sort"
                      label={t('channelSections.sort')}
                      activeCount={props.preferences.sort !== 'name' ? 1 : 0}
                    >
                      <div
                        role="radiogroup"
                        aria-label={t('channelSections.sort')}
                      >
                        <For each={sorts()}>
                          {(sort) => (
                            <MobileFilterDrawer.Option
                              selectionMode="single"
                              checked={props.preferences.sort === sort.value}
                              onChange={() =>
                                props.onPreferences({ sort: sort.value })
                              }
                            >
                              {sort.label}
                            </MobileFilterDrawer.Option>
                          )}
                        </For>
                      </div>
                    </MobileFilterDrawer.Section>
                    <MobileFilterDrawer.Section
                      value="display"
                      label={t('channelSections.display')}
                      activeCount={
                        Number(Boolean(props.preferences.unreadOnly)) +
                        Number(props.preferences.unreadWhenCollapsed === false)
                      }
                    >
                      <ToggleSwitch
                        class="min-h-11 w-full flex-row-reverse justify-between px-3"
                        label={t('channelSections.unreadOnly')}
                        checked={props.preferences.unreadOnly ?? false}
                        onChange={(unreadOnly) =>
                          props.onPreferences({ unreadOnly })
                        }
                      />
                      <ToggleSwitch
                        class="min-h-11 w-full flex-row-reverse justify-between px-3"
                        label={t('channelSections.unreadWhenCollapsed')}
                        checked={props.preferences.unreadWhenCollapsed ?? true}
                        onChange={(unreadWhenCollapsed) =>
                          props.onPreferences({ unreadWhenCollapsed })
                        }
                      />
                    </MobileFilterDrawer.Section>
                  </div>
                </Accordion>
                <MobileDrawer.Section>
                  <MobileDrawer.Item
                    disabled={
                      props.disabled || props.label.channelIds.length === 0
                    }
                    onClick={() =>
                      fireAndForget(props.onMarkRead(), 'channels-view')
                    }
                  >
                    {t('channelLabels.markAllAsRead')}
                  </MobileDrawer.Item>
                  <MobileDrawer.Item
                    disabled={props.disabled}
                    onClick={() => {
                      if (allMuted())
                        fireAndForget(props.onMute(false), 'channels-view');
                      else setMuteOpen(true);
                    }}
                  >
                    {t(
                      allMuted()
                        ? 'channelSections.unmuteAllChannels'
                        : 'channelSections.muteAllChannels'
                    )}
                    <Show when={!allMuted()}>
                      <CaretRightIcon class="ml-auto size-4" />
                    </Show>
                  </MobileDrawer.Item>
                </MobileDrawer.Section>
                <Show when={props.canEdit}>
                  <MobileDrawer.Section>
                    <MobileDrawer.Item
                      disabled={props.disabled}
                      onClick={() =>
                        fireAndForget(props.onDelete(), 'channels-view')
                      }
                      class="text-failure-ink"
                    >
                      <TrashIcon class="size-5" />
                      {t(
                        props.label.teamId
                          ? 'channelSections.deleteForEveryone'
                          : 'channelSections.deleteSection'
                      )}
                    </MobileDrawer.Item>
                  </MobileDrawer.Section>
                </Show>
              </div>
            </Show>
          </MobileDrawer.ScrollBody>
          {props.editors}
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
