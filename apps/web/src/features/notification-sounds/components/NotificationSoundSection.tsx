import { SettingsSelect } from '@app/features/settings/components/settings-select';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
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
  isNotificationSoundId,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
} from '../core/sounds';

const SOUND_OPTIONS = NOTIFICATION_SOUNDS.map((sound) => ({
  id: sound.id,
  name: sound.label,
}));

/** Sound settings for the Notifications page. */
export function NotificationSoundSection(props: {
  settings: NotificationSoundSettings;
  onEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onCategoryChange: (
    id: NotificationSoundCategoryId,
    change: Partial<NotificationSoundCategorySettings>
  ) => void;
  onPreview: (sound: NotificationSoundId) => void;
}) {
  const volumePercent = () => Math.round(props.settings.volume * 100);

  return (
    <SettingsSection
      title="Sounds"
      description="Play a sound when a notification arrives. Saved on this device."
    >
      <SettingsCard>
        <SettingsRow
          label="Notification sounds"
          description="Off by default. Incoming calls always ring."
        >
          <ToggleSwitch
            size="md"
            label="Notification sounds"
            labelClass="sr-only"
            checked={props.settings.enabled}
            onChange={props.onEnabledChange}
          />
        </SettingsRow>
        <Show when={props.settings.enabled}>
          <SettingsRow stackOnNarrow label="Volume">
            <Slider
              aria-label="Volume"
              class="w-full @[460px]:w-48"
              value={[volumePercent()]}
              minValue={0}
              maxValue={100}
              step={5}
              onChange={([percent]) => props.onVolumeChange(percent / 100)}
              onChangeEnd={() =>
                props.onPreview(props.settings.categories.mentions.sound)
              }
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb aria-valuetext={`${volumePercent()}%`}>
                  <Slider.Input aria-label="Volume" />
                </Slider.Thumb>
              </Slider.Track>
            </Slider>
            <span class="w-10 shrink-0 text-right text-sm tabular-nums text-ink-muted">
              {volumePercent()}%
            </span>
          </SettingsRow>
          <For each={NOTIFICATION_SOUND_CATEGORIES}>
            {(category) => {
              const current = () => props.settings.categories[category.id];
              return (
                <SettingsRow
                  stackOnNarrow
                  label={category.label}
                  description={category.description}
                  muted={!current().enabled}
                >
                  <SettingsSelect
                    label={`${category.label} sound`}
                    class="min-w-0 w-32"
                    options={SOUND_OPTIONS}
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
                    aria-label={`Play ${category.label} sound`}
                    tooltip="Play"
                    onClick={() => props.onPreview(current().sound)}
                  >
                    <PlayIcon class="size-4" />
                  </Button>
                  <ToggleSwitch
                    size="md"
                    label={category.label}
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
