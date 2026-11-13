import { SettingsSelect } from '@app/features/settings/components/settings-select';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { formatLocale, t } from '@app/lib/i18n';
import PlayIcon from '@icon/system/regular/play.svg';
import { Button, Slider, ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import {
  NOTIFICATION_SOUND_CATEGORIES,
  type NotificationSoundCategoryId,
} from '../core/categories';
import type {
  NotificationSoundCategorySettings,
  NotificationSoundSettings,
} from '../core/settings';
import {
  type CallSoundId,
  isNotificationSoundId,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
} from '../core/sounds';
import {
  soundCategoryDescription,
  soundCategoryLabel,
  soundLabel,
} from '../primitives/sound-text';

/** Sound settings for the Notifications page. */
export function NotificationSoundSection(props: {
  settings: NotificationSoundSettings;
  onEnabledChange: (enabled: boolean) => void;
  onCallSoundsEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onCategoryChange: (
    id: NotificationSoundCategoryId,
    change: Partial<NotificationSoundCategorySettings>
  ) => void;
  onPreview: (sound: NotificationSoundId | CallSoundId) => void;
}) {
  const volumePercent = () => Math.round(props.settings.volume * 100);
  const volumeText = () =>
    new Intl.NumberFormat(formatLocale(), { style: 'percent' }).format(
      volumePercent() / 100
    );
  const soundOptions = () =>
    NOTIFICATION_SOUNDS.map((sound) => ({
      id: sound.id,
      name: soundLabel(sound.id),
    }));

  return (
    <SettingsSection
      title={t('notificationSounds.title')}
      target="Sounds"
      description={t('notificationSounds.description')}
    >
      <SettingsCard>
        <SettingsRow
          label={t('notificationSounds.enable')}
          target="Notification sounds"
          description={t('notificationSounds.enableDescription')}
        >
          <ToggleSwitch
            size="md"
            label={t('notificationSounds.enable')}
            labelClass="sr-only"
            checked={props.settings.enabled}
            onChange={props.onEnabledChange}
          />
        </SettingsRow>
        <SettingsRow
          stackOnNarrow
          label={t('notificationSounds.callSounds')}
          description={t('notificationSounds.callSoundsDescription')}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => props.onPreview('call-join')}
          >
            {t('notificationSounds.previewJoin')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => props.onPreview('call-leave')}
          >
            {t('notificationSounds.previewLeave')}
          </Button>
          <ToggleSwitch
            size="md"
            label={t('notificationSounds.callSounds')}
            labelClass="sr-only"
            checked={props.settings.callSoundsEnabled}
            onChange={props.onCallSoundsEnabledChange}
          />
        </SettingsRow>
        <Show when={props.settings.enabled || props.settings.callSoundsEnabled}>
          <SettingsRow stackOnNarrow label={t('notificationSounds.volume')}>
            <Slider
              aria-label={t('notificationSounds.volume')}
              class="w-full @[460px]:w-48"
              value={[volumePercent()]}
              minValue={0}
              maxValue={100}
              step={5}
              onChange={([percent]) => props.onVolumeChange(percent / 100)}
              onChangeEnd={() =>
                props.onPreview(
                  props.settings.enabled
                    ? props.settings.categories.mentions.sound
                    : 'call-join'
                )
              }
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb aria-valuetext={volumeText()}>
                  <Slider.Input aria-label={t('notificationSounds.volume')} />
                </Slider.Thumb>
              </Slider.Track>
            </Slider>
            <span class="w-10 shrink-0 text-right text-sm tabular-nums text-ink-muted">
              {volumeText()}
            </span>
          </SettingsRow>
        </Show>
        <Show when={props.settings.enabled}>
          <For each={NOTIFICATION_SOUND_CATEGORIES}>
            {(category) => {
              const current = () => props.settings.categories[category.id];
              const label = () => soundCategoryLabel(category.id);
              return (
                <SettingsRow
                  stackOnNarrow
                  label={label()}
                  description={soundCategoryDescription(category.id)}
                  muted={!current().enabled}
                >
                  <SettingsSelect
                    label={t('notificationSounds.categorySound', {
                      category: label(),
                    })}
                    class="min-w-0 w-32"
                    options={soundOptions()}
                    value={current().sound}
                    onChange={(sound) => {
                      if (!isNotificationSoundId(sound)) return;
                      props.onCategoryChange(category.id, { sound });
                      props.onPreview(sound);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label={t('notificationSounds.playCategorySound', {
                      category: label(),
                    })}
                    tooltip={t('notificationSounds.play')}
                    onClick={() => props.onPreview(current().sound)}
                  >
                    <PlayIcon class="size-4" />
                  </Button>
                  <ToggleSwitch
                    size="md"
                    label={label()}
                    labelClass="sr-only"
                    checked={current().enabled}
                    onChange={(enabled) =>
                      props.onCategoryChange(category.id, { enabled })
                    }
                  />
                </SettingsRow>
              );
            }}
          </For>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}
