import { Checkbox as KobalteCheckbox } from '@kobalte/core/checkbox';
import type { ComponentProps } from 'solid-js';
import CheckIcon from '@phosphor/check.svg';
import MinusIcon from '@phosphor/minus.svg';
import { cn } from '../utils/classname';
import { splitProps } from 'solid-js';

/*
<Checkbox checked={...} onChange={...}>
  <Checkbox.Control />
</Checkbox>

A bare <Checkbox.Control /> renders its own <Checkbox.Indicator /> with a
check (or minus for indeterminate). Override by passing children:

<Checkbox.Control>
  <Checkbox.Indicator>
    <CustomGlyph />
  </Checkbox.Indicator>
</Checkbox.Control>
*/

export type CheckboxProps = ComponentProps<typeof KobalteCheckbox>;
type ControlProps = ComponentProps<typeof KobalteCheckbox.Control>;
type IndicatorProps = ComponentProps<typeof KobalteCheckbox.Indicator>;

const CONTROL_CLASS = cn(
  'inline-flex items-center justify-center size-4 shrink-0 rounded-sm text-surface',
  'bg-surface border border-edge',
  'data-checked:bg-accent data-checked:border-accent',
  'data-indeterminate:bg-accent data-indeterminate:border-accent',
  'data-disabled:opacity-50 data-disabled:cursor-not-allowed',
  'data-invalid:border-red-500',
);

function CheckboxIndicator(props: IndicatorProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <KobalteCheckbox.Indicator
      class={cn('group inline-flex items-center justify-center', local.class)}
      {...rest}
    >
      {local.children ?? (
        <>
          <CheckIcon class="size-3 group-data-indeterminate:hidden" />
          <MinusIcon class="size-3 hidden group-data-indeterminate:block" />
        </>
      )}
    </KobalteCheckbox.Indicator>
  );
}

function CheckboxControl(props: ControlProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <>
      <KobalteCheckbox.Input class="sr-only" />
      <KobalteCheckbox.Control class={cn(CONTROL_CLASS, local.class)} {...rest}>
        {local.children ?? <CheckboxIndicator />}
      </KobalteCheckbox.Control>
    </>
  );
}

export const Checkbox = Object.assign(
  (props: CheckboxProps) => {
    const [local, rest] = splitProps(props, ['class']);
    return (
      <KobalteCheckbox
        class={cn('inline-flex items-center gap-2', local.class)}
        {...rest}
      />
    );
  },
  {
    ErrorMessage: KobalteCheckbox.ErrorMessage, /* passthrough — styled via class at use sites */
    Description: KobalteCheckbox.Description,   /* passthrough — styled via class at use sites */
    Input: KobalteCheckbox.Input,               /* passthrough — Control already renders one */
    Indicator: CheckboxIndicator,
    Control: CheckboxControl,
  },
);

export const SingleSelectCheck = (props: { active: boolean }) => (
  <CheckIcon
    class={cn(
      'size-3 text-accent shrink-0',
      !props.active && 'hidden'
    )}
  />
);
