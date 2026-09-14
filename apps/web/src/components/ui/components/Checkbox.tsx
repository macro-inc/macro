import { Checkbox as KobalteCheckbox } from '@kobalte/core/checkbox';
import CheckIcon from '@phosphor/check.svg';
import MinusIcon from '@phosphor/minus.svg';
import type { ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';

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
type LabelProps = ComponentProps<typeof KobalteCheckbox.Label>;

const CONTROL_CLASS = cn(
  'inline-flex items-center justify-center size-4 shrink-0 rounded-sm text-surface',
  'bg-surface border-1 border-edge',
  'data-checked:bg-accent data-checked:border-accent',
  'data-indeterminate:bg-accent data-indeterminate:border-accent',
  'data-disabled:opacity-50 data-disabled:cursor-not-allowed',
  'data-invalid:border-failure',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-accent'
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
      <KobalteCheckbox.Input class="peer sr-only" />
      <KobalteCheckbox.Control class={cn(CONTROL_CLASS, local.class)} {...rest}>
        {local.children ?? <CheckboxIndicator />}
      </KobalteCheckbox.Control>
    </>
  );
}

function CheckboxLabel(props: LabelProps) {
  const [local, rest] = splitProps(props, ['class']);
  return <KobalteCheckbox.Label class={cn(local.class)} {...rest} />;
}

/**
 * A Kobalte checkbox with the app's control styling, composed from slots so
 * the label, description, and error message are yours to place.
 *
 * @do Always render a `Checkbox.Label`, even when the visible text sits
 *   elsewhere.
 * @do Use `indeterminate` on a select-all that only covers part of its group.
 * @do Use `InlineCheckbox` when the whole row is already clickable.
 * @dont Do not use a checkbox for an immediate action — that is a ToggleSwitch
 *   or a Button.
 * @dont Do not add `Checkbox.Input` yourself; `Checkbox.Control` already
 *   renders one.
 */
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
    ErrorMessage:
      KobalteCheckbox.ErrorMessage /* passthrough — styled via class at use sites */,
    Description:
      KobalteCheckbox.Description /* passthrough — styled via class at use sites */,
    Input:
      KobalteCheckbox.Input /* passthrough — Control already renders one */,
    Indicator: CheckboxIndicator,
    Control: CheckboxControl,
    Label: CheckboxLabel,
  }
);

export const SingleSelectCheck = (props: { active: boolean }) => (
  <CheckIcon
    class={cn('size-3 text-accent shrink-0', !props.active && 'hidden')}
  />
);

/**
 * Inline checkbox affordance — a small square that fills accent when checked
 * and shows an outlined empty box when not. Matches the soup-menu checkbox
 * pattern. Visual-only; pair with a clickable parent for the actual toggle.
 */
export const InlineCheckbox = (props: { checked: boolean }) => (
  <span
    aria-hidden
    class={cn(
      'inline-flex items-center justify-center size-3.5 shrink-0 rounded-sm',
      props.checked
        ? 'bg-accent text-surface'
        : 'bg-transparent border-1 border-edge-muted text-transparent'
    )}
  >
    <CheckIcon class="size-2.5" />
  </span>
);
