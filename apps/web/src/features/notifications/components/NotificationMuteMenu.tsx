import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { formatSnoozeDeadline, snoozePresets } from '../core/snooze';

export type NotificationMuteMenuProps = {
  label: string;
  unmuteLabel: string;
  muted: boolean;
  disabled?: boolean;
  onMute: (muted: boolean) => void;
  onSnooze: (until?: Date) => void;
  /**
   * Offers notifying for direct @mentions only. Present when every target
   * supports it; `active` when every target already has it.
   */
  mentionsOnly?: { active: boolean; onChange: (active: boolean) => void };
  /** Why the target is muted, beside Unmute: "Until 3:00 PM", "Muted by Work". */
  mutedHint?: string;
  onActionComplete?: () => void;
};

type MuteOptionsProps = Pick<
  NotificationMuteMenuProps,
  'disabled' | 'onMute' | 'onSnooze' | 'mentionsOnly' | 'onActionComplete'
>;

function presetTranslationKey(id: string, now: Date) {
  return match(id)
    .with('30-minutes', () => 'channelSections.muteFor30Minutes' as const)
    .with('1-hour', () => 'channelSections.muteFor1Hour' as const)
    .with('3-hours', () => 'channelSections.muteFor3Hours' as const)
    .with('morning', () => 'channelSections.muteUntilMorning' as const)
    .with('weekend', () =>
      now.getDay() === 0 || now.getDay() >= 5
        ? ('channelSections.muteForWeekend' as const)
        : ('channelSections.muteUntilMonday' as const)
    )
    .otherwise(() => 'channelSections.muteForWeek' as const);
}

function muteOptions(props: MuteOptionsProps) {
  const now = new Date();
  const select = (action: () => void) => {
    action();
    props.onActionComplete?.();
  };
  const mentionsOnly = props.mentionsOnly;
  return [
    ...(mentionsOnly
      ? [
          {
            id: 'mentions-only',
            get label() {
              return t('channelSections.onlyMentions');
            },
            deadline: undefined,
            checked: mentionsOnly.active,
            separatorBefore: false,
            select: () =>
              select(() => mentionsOnly.onChange(!mentionsOnly.active)),
          },
        ]
      : []),
    {
      id: 'mute',
      get label() {
        return t('channelSections.muteIndefinitely');
      },
      deadline: undefined,
      checked: false,
      separatorBefore: mentionsOnly !== undefined,
      select: () => select(() => props.onMute(true)),
    },
    ...snoozePresets(now).map((preset, index) => ({
      id: preset.id,
      checked: false,
      separatorBefore: index === 0,
      get label() {
        return t(presetTranslationKey(preset.id, now));
      },
      get deadline() {
        return formatSnoozeDeadline(preset.until, formatLocale());
      },
      select: () => select(() => props.onSnooze(preset.until)),
    })),
    {
      id: 'custom',
      get label() {
        return t('channelSections.customMute');
      },
      deadline: undefined,
      checked: false,
      separatorBefore: true,
      select: () => select(() => props.onSnooze()),
    },
  ];
}

/** Shared entity and section submenu; callers own targets and mutations. */
export function NotificationMuteMenu(props: NotificationMuteMenuProps) {
  const unmute = () => {
    props.onMute(false);
    props.onActionComplete?.();
  };

  return (
    <Show
      when={!props.muted}
      fallback={
        <Show
          when={props.mutedHint}
          fallback={
            <MenuItem
              text={props.unmuteLabel}
              icon={BellIcon}
              disabled={props.disabled}
              onClick={unmute}
            />
          }
        >
          {(hint) => (
            <ContextMenu.Item
              class={MENU_ITEM_CLASS}
              disabled={props.disabled}
              onSelect={unmute}
            >
              <BellIcon class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{props.unmuteLabel}</span>
              <span class="ml-auto shrink-0 text-right text-xs whitespace-nowrap text-ink-extra-muted">
                {hint()}
              </span>
            </ContextMenu.Item>
          )}
        </Show>
      }
    >
      <ContextMenu.Sub>
        <SubTrigger
          text={props.label}
          icon={BellSlashIcon}
          disabled={props.disabled}
        />
        <ContextMenuContent submenu class="min-w-64">
          <For each={muteOptions(props)}>
            {(option) => (
              <>
                <Show when={option.separatorBefore}>
                  <MenuSeparator />
                </Show>
                <ContextMenu.Item
                  class={MENU_ITEM_CLASS}
                  disabled={props.disabled}
                  data-mute-option={option.id}
                  aria-checked={option.checked}
                  onSelect={option.select}
                >
                  <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  <Show when={option.checked}>
                    <CheckIcon class="ml-auto size-4 shrink-0" />
                  </Show>
                  <Show when={option.deadline}>
                    {(deadline) => (
                      <span class="ml-auto shrink-0 text-right text-xs whitespace-nowrap text-ink-extra-muted">
                        {deadline()}
                      </span>
                    )}
                  </Show>
                </ContextMenu.Item>
              </>
            )}
          </For>
        </ContextMenuContent>
      </ContextMenu.Sub>
    </Show>
  );
}

/** The same choices inside a host drawer's drill-in page. */
export function NotificationMuteOptions(props: MuteOptionsProps) {
  return (
    <For each={muteOptions(props)}>
      {(option) => (
        <MobileDrawer.Item
          disabled={props.disabled}
          data-mute-option={option.id}
          onClick={option.select}
        >
          <span class="min-w-0 flex-1">{option.label}</span>
          <Show when={option.checked}>
            <CheckIcon class="ml-auto size-4 shrink-0" />
          </Show>
          <Show when={option.deadline}>
            {(deadline) => (
              <span class="ml-auto shrink-0 text-right text-xs whitespace-nowrap text-ink-muted">
                {deadline()}
              </span>
            )}
          </Show>
        </MobileDrawer.Item>
      )}
    </For>
  );
}

export function NotificationMutePage(
  props: MuteOptionsProps & { onBack: () => void }
) {
  return (
    <>
      <MobileDrawer.Item type="button" onClick={props.onBack}>
        <ArrowLeftIcon class="size-4" />
        {t('common.back')}
      </MobileDrawer.Item>
      <NotificationMuteOptions {...props} />
    </>
  );
}
