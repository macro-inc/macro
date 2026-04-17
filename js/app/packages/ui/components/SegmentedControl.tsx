import { cn } from '@ui/utils/classname';
import { For, type JSX } from 'solid-js';

export type SegmentedControlOption<T extends string | number | boolean> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string | number | boolean> = {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  class?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Optional aria-label for the control group */
  'aria-label'?: string;
};

/**
 * SegmentedControl component - a set of mutually exclusive options styled as connected buttons.
 * Uses the same visual pattern as the Settings tabs.
 *
 * @example
 * <SegmentedControl
 *   value={isMultiSelect()}
 *   onChange={setIsMultiSelect}
 *   options={[
 *     { value: false, label: 'Single Select' },
 *     { value: true, label: 'Multi Select' }
 *   ]}
 * />
 */
export const SegmentedControl = <T extends string | number | boolean>(
  props: SegmentedControlProps<T>
): JSX.Element => {
  const size = () => props.size ?? 'md';

  const containerClass = () =>
    cn(
      'border border-edge-muted rounded-xs inline-flex overflow-hidden',
      props.class
    );

  const buttonClass = (isSelected: boolean, isDisabled: boolean) =>
    cn(
      'relative flex items-center justify-center border-r border-edge-muted last:border-r-0 font-medium',
      size() === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
      isDisabled && 'opacity-50 cursor-not-allowed',
      !isDisabled && [
        isSelected
          ? 'text-ink bg-ink/10'
          : 'text-ink-muted hover:text-ink hover:bg-ink/15',
        isSelected && 'hover:bg-ink/20',
      ]
    );

  return (
    <div
      class={containerClass()}
      role="radiogroup"
      aria-label={props['aria-label']}
    >
      <For each={props.options}>
        {(option) => {
          const isSelected = () => option.value === props.value;
          const isDisabled = () => option.disabled ?? false;

          return (
            <button
              type="button"
              role="radio"
              aria-checked={isSelected()}
              disabled={isDisabled()}
              onClick={() => {
                if (!isDisabled()) {
                  props.onChange(option.value);
                }
              }}
              class={buttonClass(isSelected(), isDisabled())}
            >
              {option.label}
            </button>
          );
        }}
      </For>
    </div>
  );
};
