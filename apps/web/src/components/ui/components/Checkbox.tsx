import CheckIcon from '@icon/system/regular/check.svg';
import {
  Checkbox as KobalteCheckbox,
  useCheckboxContext,
} from '@kobalte/core/checkbox';
import {
  type ComponentProps,
  createContext,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants } from '../utils/variants';

export type CheckboxSize = 'sm' | 'md' | 'lg';
export type CheckboxProps = ComponentProps<typeof KobalteCheckbox> & {
  size?: CheckboxSize;
};
type ControlProps = ComponentProps<typeof KobalteCheckbox.Control>;
type IndicatorProps = ComponentProps<typeof KobalteCheckbox.Indicator>;
type LabelProps = ComponentProps<typeof KobalteCheckbox.Label>;

const CheckboxSizeContext = createContext((): CheckboxSize => 'md');
const checkboxVariants = createVariants(
  'inline-grid shrink-0 place-items-center rounded border border-border-primary bg-transparent text-button-accent-ink data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent',
  {
    size: {
      sm: 'size-3.5',
      md: 'size-4',
      lg: 'size-5',
    },
  },
  { size: 'md' }
);
const markSizes: Record<CheckboxSize, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
};

/** Keep both paths mounted so checking and unchecking use the same motion. */
function CheckboxMark(props: {
  checked: boolean;
  indeterminate: boolean;
  size: CheckboxSize;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cn('block', markSizes[props.size])}
    >
      <path
        d="M2 6.25 4.5 8.75 10 3.25"
        pathLength="1"
        stroke-dasharray="1 2"
        stroke-dashoffset={props.checked && !props.indeterminate ? 0 : 1.2}
        class="transition-[stroke-dashoffset] duration-100 ease-out motion-reduce:transition-none"
      />
      <path
        d="M2.5 6h7"
        pathLength="1"
        stroke-dasharray="1 2"
        stroke-dashoffset={props.indeterminate ? 0 : 1.2}
        class="transition-[stroke-dashoffset] duration-100 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

function CheckboxIndicator(props: IndicatorProps) {
  const [local, rest] = splitProps(props, ['class', 'children', 'forceMount']);
  const context = useCheckboxContext();
  const size = useContext(CheckboxSizeContext);
  return (
    <KobalteCheckbox.Indicator
      forceMount={local.forceMount ?? local.children == null}
      class={cn('inline-flex items-center justify-center', local.class)}
      {...rest}
    >
      {local.children ?? (
        <CheckboxMark
          checked={context.checked()}
          indeterminate={context.indeterminate()}
          size={size()}
        />
      )}
    </KobalteCheckbox.Indicator>
  );
}

function CheckboxControl(props: ControlProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const size = useContext(CheckboxSizeContext);
  return (
    <>
      <KobalteCheckbox.Input class="peer sr-only" />
      <KobalteCheckbox.Control
        class={cn(
          checkboxVariants({ size: size() }),
          'data-disabled:cursor-not-allowed data-invalid:border-failure peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          local.class
        )}
        {...rest}
      >
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
 * A checkbox for a value that can be saved or selected independently.
 *
 * @do Use the size prop rather than resizing the control with classes.
 * @do Render a Checkbox.Label or provide an accessible name on the root.
 * @do Use indeterminate when only part of a select-all group is checked.
 * @do Use InlineCheckbox when an enclosing option owns the interaction.
 * @dont Add Checkbox.Input yourself; Checkbox.Control already renders one.
 * @dont Use a checkbox for an immediate setting change; use ToggleSwitch.
 */
export const Checkbox = Object.assign(
  (props: CheckboxProps) => {
    const [local, rest] = splitProps(props, ['class', 'size']);
    return (
      <CheckboxSizeContext.Provider value={() => local.size ?? 'md'}>
        <KobalteCheckbox
          class={cn(
            'relative inline-flex items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
            local.class
          )}
          {...rest}
        />
      </CheckboxSizeContext.Provider>
    );
  },
  {
    ErrorMessage: KobalteCheckbox.ErrorMessage,
    Description: KobalteCheckbox.Description,
    Input: KobalteCheckbox.Input,
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

/** Visual-only; the enclosing row owns selection, focus, and input semantics. */
export const InlineCheckbox = (props: {
  checked: boolean;
  indeterminate?: boolean;
  size?: CheckboxSize;
}) => (
  <span
    aria-hidden="true"
    data-checked={props.checked ? '' : undefined}
    data-indeterminate={props.indeterminate ? '' : undefined}
    class={checkboxVariants({ size: props.size ?? 'sm' })}
  >
    <CheckboxMark
      checked={props.checked}
      indeterminate={props.indeterminate ?? false}
      size={props.size ?? 'sm'}
    />
  </span>
);
