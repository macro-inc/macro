import {
  Checkbox,
  cn,
  Input,
  type InputProps,
  Select,
  TextField,
  type TextFieldTextAreaProps,
} from '@ui';
import {
  createContext,
  createUniqueId,
  type JSX,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { TimezoneSelect } from './TimezoneSelect';

const FieldErrorContext = createContext<{
  readonly error?: string;
  errorId: string;
}>();

export function FieldError(props: { id: string; message?: string }) {
  return (
    <Show when={props.message}>
      <p
        id={props.id}
        role="alert"
        class="text-xs leading-relaxed text-failure"
      >
        {props.message}
      </p>
    </Show>
  );
}
export function Field(props: {
  label: string;
  hint?: string;
  error?: string;
  children: JSX.Element;
  class?: string;
  labelClass?: string;
}) {
  const errorId = createUniqueId();
  return (
    <FieldErrorContext.Provider
      value={{
        get error() {
          return props.error;
        },
        errorId,
      }}
    >
      <div
        class={cn('flex min-w-0 flex-col gap-2 text-sm text-ink', props.class)}
      >
        <label class="flex min-w-0 flex-col gap-2">
          <span class={cn('font-medium', props.labelClass)}>{props.label}</span>
          {props.children}
        </label>
        <FieldError id={errorId} message={props.error} />
        <Show when={props.hint}>
          <span class="text-xs leading-relaxed text-ink-muted">
            {props.hint}
          </span>
        </Show>
      </div>
    </FieldErrorContext.Provider>
  );
}
export function TextInput(props: InputProps) {
  const field = useContext(FieldErrorContext);
  return (
    <Input
      {...props}
      aria-invalid={props['aria-invalid'] ?? (field?.error ? true : undefined)}
      aria-describedby={
        [props['aria-describedby'], field?.error ? field.errorId : undefined]
          .filter(Boolean)
          .join(' ') || undefined
      }
    />
  );
}
export function TextArea(props: TextFieldTextAreaProps<'textarea'>) {
  const [local, rest] = splitProps(props, ['value', 'disabled', 'required']);
  return (
    <TextField
      value={local.value == null ? undefined : String(local.value)}
      disabled={local.disabled}
      required={local.required}
    >
      <TextField.TextArea<'textarea'> {...rest} />
    </TextField>
  );
}
export function SelectInput(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  class?: string;
  contentClass?: string;
}) {
  const field = useContext(FieldErrorContext);
  const errorId = createUniqueId();
  const message = () => props.error ?? field?.error;
  const descriptionId = () =>
    props.error ? errorId : field?.error ? field.errorId : undefined;
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Select<{ value: string; label: string }>
        options={props.options}
        optionValue="value"
        optionTextValue="label"
        value={props.options.find((o) => o.value === props.value)}
        onChange={(option) => option && props.onChange(option.value)}
        disabled={props.disabled}
        required={props.required}
        modal={false}
      >
        <Select.Label class="sr-only">{props.label}</Select.Label>
        <Select.Trigger
          aria-label={props.label}
          aria-invalid={message() ? true : undefined}
          aria-describedby={descriptionId()}
          class={cn(
            'aria-invalid:border-failure aria-invalid:ring-2 aria-invalid:ring-failure/20',
            props.class
          )}
        >
          <Select.Value<{ value: string; label: string }>>
            {(state) => state.selectedOption()?.label}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
        <Select.Content portalScope="local" class={props.contentClass}>
          <Select.Listbox />
        </Select.Content>
      </Select>
      <FieldError id={errorId} message={props.error} />
    </div>
  );
}
export function TimeZoneInput(props: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={props.disabled} class="min-w-0">
      <TimezoneSelect
        value={props.value}
        onChange={props.onChange}
        options={Intl.supportedValuesOf('timeZone').map((value) => ({
          value,
          label: value.replaceAll('_', ' '),
        }))}
        class="h-10 w-full rounded-lg border-edge bg-surface-2 px-3"
      />
    </fieldset>
  );
}
export function CheckField(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  class?: string;
  controlClass?: string;
}) {
  return (
    <Checkbox
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
      class={cn('gap-3 text-sm', props.class)}
    >
      <Checkbox.Control class={props.controlClass} />
      <Checkbox.Label>{props.label}</Checkbox.Label>
    </Checkbox>
  );
}
