import Minus from '@icon/system/regular/minus.svg';
import Plus from '@icon/system/regular/plus.svg';
import { NumberField as KobalteNumberField } from '@kobalte/core/number-field';
import {
  type Accessor,
  type ComponentProps,
  createContext,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';
import {
  InputGroup,
  type InputGroupAddonProps,
  type InputGroupInputProps,
  type InputGroupProps,
} from './InputGroup';

export type NumberUnitInputProps = ComponentProps<
  typeof KobalteNumberField<'div'>
>;
const ReadOnlyContext = createContext<Accessor<boolean>>();

/**
 * @do Give the input an accessible name and keep unit conversions in the caller.
 * @do Put the number and unit inside Frame, with optional Controls outside it.
 * @dont Use the unit label as the input's only accessible name.
 */
function Root(props: NumberUnitInputProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ReadOnlyContext.Provider value={() => props.readOnly ?? false}>
      <KobalteNumberField
        class={cn('flex max-w-full items-center gap-2', local.class)}
        changeOnWheel={false}
        {...rest}
      />
    </ReadOnlyContext.Provider>
  );
}

/** Only the number and unit live inside the frame; triggers remain outside. */
function Frame(props: InputGroupProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <InputGroup
      size="lg"
      class={cn('w-auto', local.class)}
      data-number-unit-input
      {...rest}
    />
  );
}

export type NumberUnitInputInputProps = ComponentProps<
  typeof KobalteNumberField.Input<typeof InputGroup.Input>
> &
  InputGroupInputProps;
function Input(props: NumberUnitInputInputProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteNumberField.Input<typeof InputGroup.Input>
      as={InputGroup.Input}
      class={cn('w-[6ch] flex-none px-2 text-left text-sm', local.class)}
      {...rest}
    />
  );
}

export type NumberUnitInputUnitProps = ComponentProps<
  typeof KobalteNumberField.Description<typeof InputGroup.Addon>
>;
function Unit(props: NumberUnitInputUnitProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteNumberField.Description<typeof InputGroup.Addon>
      as={InputGroup.Addon}
      align="inline-end"
      data-number-unit
      class={cn('pe-2 text-sm text-ink-muted', local.class)}
      {...rest}
    />
  );
}

function Controls(props: InputGroupAddonProps) {
  const [local, rest] = splitProps(props, ['align', 'class']);
  return (
    <div
      data-align={local.align}
      class={cn('flex shrink-0 items-center gap-1', local.class)}
      {...rest}
    />
  );
}

export type NumberUnitInputIncrementProps = ComponentProps<
  typeof KobalteNumberField.IncrementTrigger<typeof Button>
> &
  ButtonProps;
export type NumberUnitInputDecrementProps = ComponentProps<
  typeof KobalteNumberField.DecrementTrigger<typeof Button>
> &
  ButtonProps;
function StepButton(props: ButtonProps) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <Button
      variant="outline"
      {...props}
      disabled={props.disabled || readOnly?.()}
    />
  );
}

function IncrementTrigger(props: NumberUnitInputIncrementProps) {
  const [local, rest] = splitProps(props, ['children']);
  return (
    <KobalteNumberField.IncrementTrigger<typeof StepButton>
      as={StepButton}
      type="button"
      size="icon-md"
      label="Increase value"
      {...rest}
    >
      {local.children ?? <Plus class="size-3.5" />}
    </KobalteNumberField.IncrementTrigger>
  );
}

function DecrementTrigger(props: NumberUnitInputDecrementProps) {
  const [local, rest] = splitProps(props, ['children']);
  return (
    <KobalteNumberField.DecrementTrigger<typeof StepButton>
      as={StepButton}
      type="button"
      size="icon-md"
      label="Decrease value"
      {...rest}
    >
      {local.children ?? <Minus class="size-3.5" />}
    </KobalteNumberField.DecrementTrigger>
  );
}

/** Kobalte owns editing and stepping; Frame contains only the number and unit. */
export const NumberUnitInput = Object.assign(Root, {
  Frame,
  Input,
  Unit,
  Controls,
  IncrementTrigger,
  DecrementTrigger,
  Label: KobalteNumberField.Label,
  Description: KobalteNumberField.Description,
  ErrorMessage: KobalteNumberField.ErrorMessage,
  HiddenInput: KobalteNumberField.HiddenInput,
});
