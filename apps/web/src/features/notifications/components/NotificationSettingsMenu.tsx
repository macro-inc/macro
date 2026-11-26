import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuGroup,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { InlineCheckbox, SingleSelectCheck } from '@ui';
import { createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { openCustomNotificationSettings } from '../CustomNotificationSettingsDialog';
import {
  CHANNEL_NOTIFICATION_KINDS,
  type NotificationPreset,
  sameKinds,
} from '../core/channel-notification-settings';
import {
  notificationKindLabel,
  presetLabel,
  presetSummary,
} from './notification-settings-labels';

export type NotificationSettingsMenuProps = {
  preset: NotificationPreset;
  /** The kinds the target notifies for now. */
  enabled: ReadonlySet<ChannelNotificationKind>;
  /** Where an inheriting channel's settings come from: "Inherited from Engineering". */
  hint?: string;
  /** Where the settings Custom shows come from; a section's are its own, so it has none. */
  source?: string;
  /** The channel or section, named in the custom settings dialog. */
  targetName: string;
  disabled?: boolean;
  onPreset: (preset: Exclude<NotificationPreset, 'custom'>) => void;
  onSetKinds: (kinds: ReadonlySet<ChannelNotificationKind>) => void;
  /**
   * Use section default, which drops the channel's own settings; present
   * when it has some and sits in a section. `description` says what it gives.
   */
  sectionDefault?: { description: string; onSelect: () => void };
  /** Phone: save the Custom page's kinds once on leaving it, not per toggle. */
  saveCustomOnLeave?: boolean;
  onActionComplete?: () => void;
};

const PRESETS = ['all', 'involving', 'custom', 'nothing'] as const;

/** The current preset, shown after "Notification settings" on a phone row. */
export function NotificationSettingsSummary(props: {
  preset: NotificationPreset;
}) {
  return (
    <span class="ml-auto truncate text-sm text-ink-muted">
      {presetSummary(props.preset)}
    </span>
  );
}

function LabelWithDescription(props: { label: string; description: string }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate">{props.label}</span>
      <span class="truncate text-xs text-ink-muted">{props.description}</span>
    </span>
  );
}

/**
 * Desktop submenu: Use section default when the channel has its own
 * settings, then one choice of All, Involving me, Custom or Nothing.
 */
export function NotificationSettingsMenu(props: NotificationSettingsMenuProps) {
  const choose = (preset: NotificationPreset) => {
    // Close the host menu before Custom opens its dialog: dismissing a menu
    // after the dialog is up would dismiss the dialog with it.
    props.onActionComplete?.();
    if (preset === 'custom') {
      openCustomNotificationSettings({
        targetName: props.targetName,
        enabled: props.enabled,
        source: props.source,
        onSave: props.onSetKinds,
      });
    } else {
      props.onPreset(preset);
    }
  };

  return (
    <ContextMenu.Sub>
      <SubTrigger
        text={
          <LabelWithDescription
            label={t('channelSections.notificationSettings')}
            description={presetSummary(props.preset)}
          />
        }
        icon={BellIcon}
        disabled={props.disabled}
      />
      <ContextMenuContent submenu class="min-w-60 max-w-80">
        <Show when={props.sectionDefault}>
          {(sectionDefault) => (
            <>
              <MenuGroup>
                <ContextMenu.Item
                  class={MENU_ITEM_CLASS}
                  disabled={props.disabled}
                  data-notification-section-default
                  onSelect={() => {
                    sectionDefault().onSelect();
                    props.onActionComplete?.();
                  }}
                >
                  <LabelWithDescription
                    label={t('channelSections.useSectionDefault')}
                    description={sectionDefault().description}
                  />
                </ContextMenu.Item>
              </MenuGroup>
              <MenuSeparator />
            </>
          )}
        </Show>
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
      </ContextMenuContent>
    </ContextMenu.Sub>
  );
}

/** The six kinds as toggling rows, under where the settings come from. */
function CustomSettingsPage(
  props: NotificationSettingsMenuProps & { onBack: () => void }
) {
  // With saveCustomOnLeave the rows edit a draft, saved once on leaving. The
  // save is captured at mount: closing the sheet tears down the props' owners,
  // so the cleanup must not read them.
  const saveOnLeave = untrack(() => props.saveCustomOnLeave === true);
  const save = untrack(() => props.onSetKinds);
  const initial = untrack(() => new Set(props.enabled));
  const [draft, setDraft] = createSignal<ChannelNotificationKind[]>(
    CHANNEL_NOTIFICATION_KINDS.filter((kind) => initial.has(kind))
  );
  const shown = () => (saveOnLeave ? new Set(draft()) : props.enabled);

  let saved = false;
  const saveDraft = () => {
    if (!saveOnLeave || saved) return;
    saved = true;
    const kinds = new Set(draft());
    if (!sameKinds(kinds, initial)) save(kinds);
  };
  // Closing the sheet from this page leaves it too; save once teardown ends.
  onCleanup(() => {
    if (saveOnLeave && !saved) queueMicrotask(saveDraft);
  });

  const toggle = (kind: ChannelNotificationKind) => {
    const kinds = new Set(shown());
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    if (saveOnLeave) {
      setDraft(CHANNEL_NOTIFICATION_KINDS.filter((each) => kinds.has(each)));
    } else {
      props.onSetKinds(kinds);
    }
  };

  return (
    <>
      <MobileDrawer.Item
        type="button"
        onClick={() => {
          saveDraft();
          props.onBack();
        }}
      >
        <ArrowLeftIcon class="size-4" />
        {t('common.back')}
      </MobileDrawer.Item>
      <Show when={props.source}>
        {(source) => (
          <div class="px-4 py-2 text-sm text-ink-muted">{source()}</div>
        )}
      </Show>
      <For each={CHANNEL_NOTIFICATION_KINDS}>
        {(kind) => (
          <MobileDrawer.Item
            type="button"
            role="checkbox"
            aria-checked={shown().has(kind)}
            disabled={props.disabled}
            data-notification-kind={kind}
            onClick={() => toggle(kind)}
          >
            <span class="min-w-0 flex-1">{notificationKindLabel(kind)}</span>
            <InlineCheckbox checked={shown().has(kind)} />
          </MobileDrawer.Item>
        )}
      </For>
    </>
  );
}

/**
 * Phone drill-in pages inside a host drawer: Use section default and the
 * four choices, and the six kinds as checkboxes for Custom settings.
 */
export function NotificationSettingsPage(
  props: NotificationSettingsMenuProps & { onBack: () => void }
) {
  const [custom, setCustom] = createSignal(false);

  const finish = (action: () => void) => {
    action();
    props.onActionComplete?.();
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
          <Show when={props.sectionDefault}>
            {(sectionDefault) => (
              <MobileDrawer.Item
                type="button"
                disabled={props.disabled}
                data-notification-section-default
                onClick={() => finish(() => sectionDefault().onSelect())}
              >
                <LabelWithDescription
                  label={t('channelSections.useSectionDefault')}
                  description={sectionDefault().description}
                />
              </MobileDrawer.Item>
            )}
          </Show>
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
        </>
      }
    >
      <CustomSettingsPage {...props} onBack={() => setCustom(false)} />
    </Show>
  );
}
