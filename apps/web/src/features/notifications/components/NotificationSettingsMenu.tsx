import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { InlineCheckbox, SingleSelectCheck } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { openCustomNotificationSettings } from '../CustomNotificationSettingsDialog';
import {
  CHANNEL_NOTIFICATION_KINDS,
  type NotificationPreset,
} from '../core/channel-notification-settings';
import {
  notificationKindLabel,
  presetLabel,
} from './notification-settings-labels';

export type NotificationSettingsMenuProps = {
  preset: NotificationPreset;
  /** The kinds the target notifies for now. */
  enabled: ReadonlySet<ChannelNotificationKind>;
  /** Where the settings come from, such as "Following Engineering". */
  hint?: string;
  /** The channel or section, named in the custom settings dialog. */
  targetName: string;
  disabled?: boolean;
  onPreset: (preset: Exclude<NotificationPreset, 'custom'>) => void;
  onSetKinds: (kinds: ReadonlySet<ChannelNotificationKind>) => void;
  /** Present when the channel has its own settings and its sections have some. */
  onFollowSections?: () => void;
  onActionComplete?: () => void;
};

const PRESETS = ['all', 'involving', 'custom', 'nothing'] as const;

/** Desktop submenu: one choice of All, Involving me, Custom or Nothing. */
export function NotificationSettingsMenu(props: NotificationSettingsMenuProps) {
  const choose = (preset: NotificationPreset) => {
    if (preset === 'custom') {
      openCustomNotificationSettings({
        targetName: props.targetName,
        enabled: props.enabled,
        onSave: props.onSetKinds,
      });
    } else {
      props.onPreset(preset);
    }
    props.onActionComplete?.();
  };

  return (
    <ContextMenu.Sub>
      <SubTrigger
        text={t('channelSections.notificationSettings')}
        icon={BellIcon}
        disabled={props.disabled}
      />
      <ContextMenuContent submenu class="min-w-60 max-w-80">
        <Show when={props.hint}>
          {(hint) => (
            <div class="truncate px-2 py-1 text-xs text-ink-extra-muted">
              {hint()}
            </div>
          )}
        </Show>
        <MenuGroup>
          <ContextMenu.RadioGroup value={props.preset}>
            <For each={PRESETS}>
              {(preset) => (
                <ContextMenu.RadioItem
                  class={MENU_ITEM_CLASS}
                  value={preset}
                  disabled={props.disabled}
                  data-notification-preset={preset}
                  closeOnSelect
                  onSelect={() => choose(preset)}
                >
                  <span class="min-w-0 flex-1 truncate">
                    {presetLabel(preset)}
                  </span>
                  <SingleSelectCheck active={props.preset === preset} />
                </ContextMenu.RadioItem>
              )}
            </For>
          </ContextMenu.RadioGroup>
        </MenuGroup>
        <Show when={props.onFollowSections}>
          {(follow) => (
            <>
              <MenuSeparator />
              <MenuItem
                text={t('channelSections.useSectionSettings')}
                disabled={props.disabled}
                onClick={() => {
                  follow()();
                  props.onActionComplete?.();
                }}
              />
            </>
          )}
        </Show>
      </ContextMenuContent>
    </ContextMenu.Sub>
  );
}

/**
 * Phone drill-in pages inside a host drawer: the four choices, and the six
 * kinds as checkboxes for Custom settings.
 */
export function NotificationSettingsPage(
  props: NotificationSettingsMenuProps & { onBack: () => void }
) {
  const [custom, setCustom] = createSignal(false);

  const finish = (action: () => void) => {
    action();
    props.onActionComplete?.();
  };

  const toggle = (kind: ChannelNotificationKind) => {
    const kinds = new Set(props.enabled);
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    props.onSetKinds(kinds);
  };

  return (
    <Show
      when={custom()}
      fallback={
        <>
          <MobileDrawer.Item type="button" onClick={props.onBack}>
            <ArrowLeftIcon class="size-4" />
            {t('common.back')}
          </MobileDrawer.Item>
          <Show when={props.hint}>
            {(hint) => (
              <div class="px-4 py-2 text-sm text-ink-muted">{hint()}</div>
            )}
          </Show>
          <For each={PRESETS}>
            {(preset) => (
              <MobileDrawer.Item
                type="button"
                role="radio"
                aria-checked={props.preset === preset}
                disabled={props.disabled}
                data-notification-preset={preset}
                onClick={() =>
                  preset === 'custom'
                    ? setCustom(true)
                    : finish(() => props.onPreset(preset))
                }
              >
                <span class="min-w-0 flex-1">{presetLabel(preset)}</span>
                <Show when={props.preset === preset}>
                  <CheckIcon class="ml-auto size-4 shrink-0" />
                </Show>
              </MobileDrawer.Item>
            )}
          </For>
          <Show when={props.onFollowSections}>
            {(follow) => (
              <MobileDrawer.Item
                type="button"
                disabled={props.disabled}
                onClick={() => finish(() => follow()())}
              >
                {t('channelSections.useSectionSettings')}
              </MobileDrawer.Item>
            )}
          </Show>
        </>
      }
    >
      <MobileDrawer.Item type="button" onClick={() => setCustom(false)}>
        <ArrowLeftIcon class="size-4" />
        {t('common.back')}
      </MobileDrawer.Item>
      <For each={CHANNEL_NOTIFICATION_KINDS}>
        {(kind) => (
          <MobileDrawer.Item
            type="button"
            role="checkbox"
            aria-checked={props.enabled.has(kind)}
            disabled={props.disabled}
            data-notification-kind={kind}
            onClick={() => toggle(kind)}
          >
            <span class="min-w-0 flex-1">{notificationKindLabel(kind)}</span>
            <InlineCheckbox checked={props.enabled.has(kind)} />
          </MobileDrawer.Item>
        )}
      </For>
    </Show>
  );
}
