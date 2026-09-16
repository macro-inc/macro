import { TextField as KobalteTextField } from '@kobalte/core/text-field';
import type { ComponentProps, ValidComponent } from 'solid-js';
import { For, Match, Switch, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Input, type InputProps, inputOutlineFocusClasses } from './Input';

// Adapted from hngngn/shadcn-solid's MIT-licensed TextField primitive.
// The slot API follows our compound-component convention and the visual
// treatment uses Macro's semantic, layer-aware tokens.

export type TextFieldProps<T extends ValidComponent = 'div'> = ComponentProps<
  typeof KobalteTextField<T>
>;

function TextFieldRoot<T extends ValidComponent = 'div'>(
  props: TextFieldProps<T>
) {
  const [local, rest] = splitProps(props as TextFieldProps, ['class']);

  return (
    <KobalteTextField
      data-slot="text-field"
      class={cn('grid w-full gap-1.5', local.class)}
      {...rest}
    />
  );
}

export type TextFieldInputProps = ComponentProps<
  typeof KobalteTextField.Input<typeof Input>
> &
  InputProps;

function TextFieldInput(props: TextFieldInputProps) {
  const [local, rest] = splitProps(props as TextFieldInputProps, ['class']);

  return (
    <KobalteTextField.Input<typeof Input>
      as={Input}
      data-slot="text-field-input"
      class={local.class}
      {...rest}
    />
  );
}

export type TextFieldTextAreaProps<T extends ValidComponent = 'textarea'> =
  ComponentProps<typeof KobalteTextField.TextArea<T>>;

function TextFieldTextArea<T extends ValidComponent = 'textarea'>(
  props: TextFieldTextAreaProps<T>
) {
  const [local, rest] = splitProps(props as TextFieldTextAreaProps, ['class']);

  return (
    <KobalteTextField.TextArea
      data-slot="text-field-textarea"
      class={cn(
        'flex min-h-20 w-full resize-none rounded-md border border-edge-muted bg-input px-2.5 py-2 text-sm text-ink caret-current outline-none transition-[border-color,box-shadow]',
        'placeholder:text-ink-placeholder',
        inputOutlineFocusClasses,
        'aria-invalid:border-failure aria-invalid:ring-2 aria-invalid:ring-failure/20',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        local.class
      )}
      {...rest}
    />
  );
}

export type TextFieldLabelProps<T extends ValidComponent = 'label'> =
  ComponentProps<typeof KobalteTextField.Label<T>>;

function TextFieldLabel<T extends ValidComponent = 'label'>(
  props: TextFieldLabelProps<T>
) {
  const [local, rest] = splitProps(props as TextFieldLabelProps, ['class']);

  return (
    <KobalteTextField.Label
      data-slot="text-field-label"
      class={cn(
        'text-sm font-medium text-ink select-none',
        'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:text-ink-disabled',
        'data-invalid:text-failure',
        local.class
      )}
      {...rest}
    />
  );
}

export type TextFieldError = { message?: string } | undefined;

export type TextFieldErrorMessageProps<T extends ValidComponent = 'div'> =
  ComponentProps<typeof KobalteTextField.ErrorMessage<T>> & {
    errors?: TextFieldError[];
  };

function TextFieldErrorMessage<T extends ValidComponent = 'div'>(
  props: TextFieldErrorMessageProps<T>
) {
  const [local, rest] = splitProps(props as TextFieldErrorMessageProps, [
    'class',
    'errors',
    'children',
  ]);
  const uniqueErrors = () => [
    ...new Map(local.errors?.map((error) => [error?.message, error])).values(),
  ];

  return (
    <KobalteTextField.ErrorMessage
      data-slot="text-field-error-message"
      class={cn('text-xs text-failure', local.class)}
      {...rest}
    >
      <Switch
        fallback={
          <ul class="ml-4 flex list-disc flex-col gap-1">
            <For each={uniqueErrors()}>
              {(error) => <li>{error?.message}</li>}
            </For>
          </ul>
        }
      >
        <Match when={local.children}>{local.children}</Match>
        <Match when={!local.errors?.length}>{null}</Match>
        <Match when={uniqueErrors().length === 1}>
          {uniqueErrors()[0]?.message}
        </Match>
      </Switch>
    </KobalteTextField.ErrorMessage>
  );
}

export type TextFieldDescriptionProps<T extends ValidComponent = 'div'> =
  ComponentProps<typeof KobalteTextField.Description<T>>;

function TextFieldDescription<T extends ValidComponent = 'div'>(
  props: TextFieldDescriptionProps<T>
) {
  const [local, rest] = splitProps(props as TextFieldDescriptionProps, [
    'class',
  ]);

  return (
    <KobalteTextField.Description
      data-slot="text-field-description"
      class={cn('text-xs text-ink-subtle', local.class)}
      {...rest}
    />
  );
}

/**
 * An accessible text input or textarea composed from Kobalte slots and styled
 * with the app's layer-aware form-control tokens.
 *
 * @do Put `TextField.Label`, the control, and any description or error inside
 *   the same root so Kobalte wires their accessible relationships.
 * @do Set `validationState="invalid"` on the root; `TextField.Input` and
 *   `TextField.TextArea` receive `aria-invalid` automatically.
 * @do Use `TextField.TextArea autoResize` for growing multiline input.
 * @dont Do not add manual `id`, `for`, or `aria-describedby` attributes when
 *   the slots share a root.
 * @dont Do not use TextField for search with suggestions or fixed-choice
 *   values; use the appropriate combobox or Select primitive.
 */
export const TextField = Object.assign(TextFieldRoot, {
  Description: TextFieldDescription,
  ErrorMessage: TextFieldErrorMessage,
  Input: TextFieldInput,
  Label: TextFieldLabel,
  TextArea: TextFieldTextArea,
});
