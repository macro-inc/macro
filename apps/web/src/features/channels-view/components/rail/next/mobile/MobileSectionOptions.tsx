import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { longPressActivated } from '@core/directive/touchHandler';
import { fireAndForget } from '@core/util/fireAndForget';
import { isMutedItem } from '@entity/utils/notification';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import {
  formatSnoozeDeadline,
  snoozePresets,
} from '@notifications/core/snooze';
import { queryReadyGate } from '@queries/gate';
import { useMutedEntitiesQuery } from '@queries/notification/unsubscribes';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { Button, Checkbox, SingleSelectCheck, ToggleSwitch } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { ChannelSectionPreferences } from '../../../../types';

import { presetTranslationKey } from '../ChannelMuteMenu';

type OptionsPage = 'main' | 'visibility' | 'sort' | 'display' | 'mute';

export function MobileSectionOptions(props: {
  label: ChannelLabel;
  teamName?: string;
  canShare: boolean;
  preferences: ChannelSectionPreferences;
  onPreferences: (preferences: ChannelSectionPreferences) => void;
  onScope: (shared: boolean) => Promise<void>;
  onRename: () => Promise<void>;
  onAdd: () => Promise<void>;
  onMatch: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMute: (muted: boolean) => Promise<void>;
  onSnooze: (until?: Date) => Promise<void>;
  disabled?: boolean;
  onClose: () => void;
  editors?: JSX.Element;
}) {
  const [page, setPage] = createSignal<OptionsPage>('main');
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
          <div class="flex items-center gap-2 px-4 pb-3">
            <Show when={page() !== 'main'}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.back')}
                onClick={() => setPage('main')}
              >
                <ArrowLeftIcon class="size-4" />
              </Button>
            </Show>
            <MobileDrawer.Title class="min-w-0 flex-1 truncate text-base font-medium">
              {props.label.name}
            </MobileDrawer.Title>
            <Show when={props.label.teamId}>
              <UsersIcon class="size-4" />
            </Show>
            <Show when={props.label.rule}>
              <FunnelIcon class="size-4" />
            </Show>
          </div>
          <MobileDrawer.ScrollBody class="px-3">
            <Switch>
              <Match when={page() === 'main'}>
                <MobileDrawer.Item
                  disabled={props.disabled}
                  onClick={() =>
                    fireAndForget(props.onRename(), 'channels-view')
                  }
                >
                  <PencilIcon class="size-5" />
                  {t('channelSections.renameSection')}
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
                <MobileDrawer.Item
                  disabled={props.disabled}
                  onClick={() =>
                    fireAndForget(props.onMatch(), 'channels-view')
                  }
                >
                  <FunnelIcon class="size-5" />
                  {t('channelSections.matchByName')}
                </MobileDrawer.Item>
                <MobileDrawer.Item onClick={() => setPage('visibility')}>
                  <UsersIcon class="size-5" />
                  {t('channelSections.visibleTo')}
                  <span class="ml-auto truncate text-sm text-ink-muted">
                    {props.label.teamId
                      ? props.teamName
                      : t('channelSections.onlyMe')}
                  </span>
                  <CaretRightIcon class="size-4" />
                </MobileDrawer.Item>
                <MobileDrawer.Item onClick={() => setPage('sort')}>
                  {t('channelSections.sort')}
                  <CaretRightIcon class="ml-auto size-4" />
                </MobileDrawer.Item>
                <MobileDrawer.Item onClick={() => setPage('display')}>
                  {t('channelSections.display')}
                  <CaretRightIcon class="ml-auto size-4" />
                </MobileDrawer.Item>
                <MobileDrawer.Item
                  disabled={props.disabled}
                  onClick={() => {
                    if (allMuted())
                      fireAndForget(props.onMute(false), 'channels-view');
                    else setPage('mute');
                  }}
                >
                  <BellSlashIcon class="size-5" />
                  {t(
                    allMuted()
                      ? 'channelSections.unmuteAllChannels'
                      : 'channelSections.muteAllChannels'
                  )}
                  <Show when={!allMuted()}>
                    <CaretRightIcon class="ml-auto size-4" />
                  </Show>
                </MobileDrawer.Item>
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
              </Match>
              <Match when={page() === 'visibility'}>
                <Checkbox
                  checked={!props.label.teamId}
                  onChange={(checked) => {
                    if (checked)
                      fireAndForget(props.onScope(false), 'channels-view');
                  }}
                  disabled={props.disabled}
                  class="flex min-h-11 items-center gap-3 px-3"
                >
                  <Checkbox.Control />
                  <Checkbox.Label>{t('channelSections.onlyMe')}</Checkbox.Label>
                </Checkbox>
                <Show when={props.canShare}>
                  <Checkbox
                    checked={Boolean(props.label.teamId)}
                    onChange={(checked) => {
                      if (checked)
                        fireAndForget(props.onScope(true), 'channels-view');
                    }}
                    disabled={props.disabled}
                    class="flex min-h-11 items-center gap-3 px-3"
                  >
                    <Checkbox.Control />
                    <Checkbox.Label>
                      {props.teamName ?? t('channelSections.team_channels')}
                    </Checkbox.Label>
                  </Checkbox>
                </Show>
              </Match>
              <Match when={page() === 'sort'}>
                <For each={sorts()}>
                  {(sort) => (
                    <MobileDrawer.Item
                      aria-pressed={props.preferences.sort === sort.value}
                      onClick={() => props.onPreferences({ sort: sort.value })}
                    >
                      {sort.label}
                      <SingleSelectCheck
                        active={props.preferences.sort === sort.value}
                      />
                    </MobileDrawer.Item>
                  )}
                </For>
              </Match>
              <Match when={page() === 'display'}>
                <ToggleSwitch
                  class="min-h-11 w-full flex-row-reverse justify-between px-3"
                  label={t('channelSections.unreadOnly')}
                  checked={props.preferences.unreadOnly ?? false}
                  onChange={(unreadOnly) => props.onPreferences({ unreadOnly })}
                />
                <ToggleSwitch
                  class="min-h-11 w-full flex-row-reverse justify-between px-3"
                  label={t('channelSections.unreadWhenCollapsed')}
                  checked={props.preferences.unreadWhenCollapsed ?? true}
                  onChange={(unreadWhenCollapsed) =>
                    props.onPreferences({ unreadWhenCollapsed })
                  }
                />
              </Match>
              <Match when={page() === 'mute'}>
                <MobileDrawer.Item
                  disabled={props.disabled}
                  onClick={() =>
                    fireAndForget(props.onMute(true), 'channels-view')
                  }
                >
                  {t('channelSections.muteIndefinitely')}
                </MobileDrawer.Item>
                <For each={snoozePresets(new Date())}>
                  {(preset) => (
                    <MobileDrawer.Item
                      disabled={props.disabled}
                      onClick={() =>
                        fireAndForget(
                          props.onSnooze(preset.until),
                          'channels-view'
                        )
                      }
                    >
                      <span class="flex-1">
                        {t(presetTranslationKey(preset.id))}
                      </span>
                      <span class="text-xs text-ink-muted">
                        {formatSnoozeDeadline(preset.until, formatLocale())}
                      </span>
                    </MobileDrawer.Item>
                  )}
                </For>
                <MobileDrawer.Item
                  disabled={props.disabled}
                  onClick={() =>
                    fireAndForget(props.onSnooze(), 'channels-view')
                  }
                >
                  {t('channelSections.customMute')}
                </MobileDrawer.Item>
              </Match>
            </Switch>
          </MobileDrawer.ScrollBody>
          {props.editors}
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
