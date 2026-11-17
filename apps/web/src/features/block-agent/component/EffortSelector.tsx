import { t } from '@app/lib/i18n';
import { ComposerSettingMenu } from '@core/component/AI/component/input/ComposerSettingMenu';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../state/session-config';

/** Effort control beside the selected model in the composer. */
export function EffortSelector(props: {
  config?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: (choice: EffortChoice) => void;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const choices = () => props.config?.options ?? [];
  const value = () => props.value ?? props.config?.currentValue;
  const index = () =>
    Math.max(
      0,
      choices().findIndex((choice) => choice.value === value())
    );
  const label = () => choices()[index()]?.name ?? '';
  const angle = () => -70 + (index() / Math.max(1, choices().length - 1)) * 140;
  const dial = () => (
    <svg viewBox="0 0 24 24" class="size-4" fill="none" aria-hidden="true">
      <path
        d="M4.5 18a9 9 0 1 1 15 0"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.45"
      />
      <g transform={`rotate(${angle()} 12 14)`}>
        <path
          d="M12 14V8"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </g>
      <circle cx="12" cy="14" r="2" fill="currentColor" />
    </svg>
  );
  return (
    <ComposerSettingMenu
      title={t('agentControls.reasoningEffort')}
      triggerLabel={t('agentControls.effortValue', { value: label() })}
      icon={dial()}
      choices={choices()}
      value={value()}
      disabled={props.disabled}
      onSelect={(choice) => {
        if (!props.config) return;
        props.onChange({
          configId: props.config.id,
          value: choice.value,
          name: choice.name,
        });
      }}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
