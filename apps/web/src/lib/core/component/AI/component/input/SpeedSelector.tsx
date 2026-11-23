import { t } from '@app/lib/i18n';
import LightningIcon from '@icon/system/fill/lightning-fill.svg';
import { match } from 'ts-pattern';
import { isModelSpeed, type ModelSpeed } from '../../constant/speed';
import {
  type ComposerSettingChoice,
  ComposerSettingMenu,
} from './ComposerSettingMenu';

function speedName(speed: ModelSpeed) {
  return match(speed)
    .with('standard', () => t('agentControls.speedStandard'))
    .with('priority', () => t('agentControls.speedPriority'))
    .with('fast', () => t('agentControls.speedFast'))
    .with('ultrafast', () => t('agentControls.speedUltrafast'))
    .exhaustive();
}

function speedDescription(speed: ModelSpeed) {
  return match(speed)
    .with('standard', () => t('agentControls.speedStandardDescription'))
    .with('priority', () => t('agentControls.speedPriorityDescription'))
    .with('fast', () => t('agentControls.speedFastDescription'))
    .with('ultrafast', () => t('agentControls.speedUltrafastDescription'))
    .exhaustive();
}

/** A tier as offered by a runtime: its value plus the runtime's own label. */
export type OfferedSpeed = { value: string; name?: string };

/**
 * The priority-tier picker beside a composer's model picker. `offered` is
 * what the model accepts (the runtime's `speed` option, or `speedsForModel`);
 * it renders nothing when the model has only standard.
 */
export function SpeedSelector(props: {
  offered: readonly OfferedSpeed[];
  value: string;
  disabled?: boolean;
  onChange: (speed: ModelSpeed) => void;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const choices = (): ComposerSettingChoice[] =>
    props.offered.map((speed) =>
      isModelSpeed(speed.value)
        ? {
            value: speed.value,
            name: speedName(speed.value),
            description: speedDescription(speed.value),
          }
        : { value: speed.value, name: speed.name ?? speed.value }
    );
  const current = () =>
    choices().find((choice) => choice.value === props.value) ?? choices()[0];
  return (
    <ComposerSettingMenu
      title={t('agentControls.priorityTier')}
      triggerLabel={t('agentControls.priorityTierValue', {
        value: current()?.name ?? '',
      })}
      icon={<LightningIcon class="size-4" />}
      choices={choices()}
      value={props.value}
      disabled={props.disabled}
      onSelect={(choice) => {
        if (isModelSpeed(choice.value)) props.onChange(choice.value);
      }}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
