import { ButtonGroup, NumberUnitInput } from '@ui';
import { batch, createSignal, For } from 'solid-js';

type DurationPart = 'hours' | 'minutes';

/** Numeric hours and minutes share a frame; their unit labels are never editable. */
export function BookingDurationInput(props: {
  value: number;
  disabled: boolean;
  error?: string;
  errorId: string;
  onChange: (minutes: number) => void;
}) {
  const [editing, setEditing] = createSignal<{
    part: DurationPart;
    text: string;
    other: number;
  }>();
  const hours = () => Math.floor(props.value / 60);
  const minutes = () => props.value % 60;
  const value = (part: DurationPart) => {
    const current = editing();
    if (current?.part === part) return current.text;
    if (current) return current.other;
    return part === 'hours' ? hours() : minutes();
  };
  const change = (part: DurationPart, text: string) => {
    if (props.disabled) return;
    const current = editing();
    const other =
      current?.part === part
        ? current.other
        : part === 'hours'
          ? minutes()
          : hours();
    const amount = text.trim() ? Number(text) : Number.NaN;
    batch(() => {
      setEditing({ part, text, other });
      if (!Number.isSafeInteger(amount) || amount < 0) return;
      const total =
        part === 'hours' ? amount * 60 + other : other * 60 + amount;
      if (Number.isSafeInteger(total) && total !== props.value)
        props.onChange(total);
    });
  };
  return (
    <ButtonGroup
      size="lg"
      class="h-9 w-auto rounded-lg border-edge-frame data-[orientation=horizontal]:rounded-lg has-[[data-slot=input-group-control]]:rounded-lg has-[[data-slot=input-group-control][aria-invalid=true]]:border-failure"
    >
      <For each={['hours', 'minutes'] as const}>
        {(part) => (
          <NumberUnitInput
            format={false}
            value={value(part)}
            minValue={0}
            step={1}
            required
            disabled={props.disabled}
            validationState={props.error ? 'invalid' : 'valid'}
            onChange={(text) => change(part, text)}
          >
            <NumberUnitInput.Frame>
              <NumberUnitInput.Input
                aria-label={`Duration ${part}`}
                aria-invalid={props.error ? true : undefined}
                aria-describedby={props.error ? props.errorId : undefined}
                class="flex-none px-1.5 text-base sm:text-sm"
                style={{
                  width: `calc(${Math.max(2, String(value(part)).length)}ch + 0.75rem)`,
                }}
                onFocus={(event) =>
                  setEditing({
                    part,
                    text: event.currentTarget.value,
                    other: part === 'hours' ? minutes() : hours(),
                  })
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onBlur={() => setEditing(undefined)}
              />
              <NumberUnitInput.Unit>
                {part === 'hours' ? 'hours' : 'mins'}
              </NumberUnitInput.Unit>
            </NumberUnitInput.Frame>
          </NumberUnitInput>
        )}
      </For>
    </ButtonGroup>
  );
}
