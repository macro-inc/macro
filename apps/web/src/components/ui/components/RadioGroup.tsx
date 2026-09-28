import { RadioGroup as KobalteRadioGroup } from '@kobalte/core/radio-group';
import type { ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';

/*
<RadioGroup value={...} onChange={...}>
  <RadioGroup.Item value="a">
    <RadioGroup.ItemControl />
    <RadioGroup.ItemLabel>Option A</RadioGroup.ItemLabel>
  </RadioGroup.Item>
</RadioGroup>

A bare <RadioGroup.ItemControl /> renders its own dot indicator. It also
renders the hidden input, so don't add <RadioGroup.ItemInput /> yourself.
*/

export type RadioGroupProps = ComponentProps<typeof KobalteRadioGroup>;
type ItemProps = ComponentProps<typeof KobalteRadioGroup.Item>;
type ItemControlProps = ComponentProps<typeof KobalteRadioGroup.ItemControl>;
type ItemLabelProps = ComponentProps<typeof KobalteRadioGroup.ItemLabel>;

const CONTROL_CLASS = cn(
  'inline-flex items-center justify-center size-4 shrink-0 rounded-full',
  'bg-surface border-1 border-edge',
  'data-checked:border-accent',
  'data-disabled:opacity-50 data-disabled:cursor-not-allowed',
  'data-invalid:border-failure',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-accent'
);

function RadioGroupItem(props: ItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteRadioGroup.Item
      class={cn('inline-flex items-center gap-2', local.class)}
      {...rest}
    />
  );
}

function RadioGroupItemControl(props: ItemControlProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <>
      <KobalteRadioGroup.ItemInput class="peer sr-only" />
      <KobalteRadioGroup.ItemControl
        class={cn(CONTROL_CLASS, local.class)}
        {...rest}
      >
        {local.children ?? (
          <KobalteRadioGroup.ItemIndicator class="size-2 rounded-full bg-accent" />
        )}
      </KobalteRadioGroup.ItemControl>
    </>
  );
}

function RadioGroupItemLabel(props: ItemLabelProps) {
  const [local, rest] = splitProps(props, ['class']);
  return <KobalteRadioGroup.ItemLabel class={cn(local.class)} {...rest} />;
}

/**
 * A Kobalte radio group with the app's control styling, composed from slots so
 * the item label, description, and error message are yours to place.
 *
 * @do Give the group an `aria-label` (or a `RadioGroup.Label`) describing the
 *   choice.
 * @do Render a `RadioGroup.ItemLabel` for every item, even when the visible
 *   text sits elsewhere.
 * @dont Do not add `RadioGroup.ItemInput` yourself; `RadioGroup.ItemControl`
 *   already renders one.
 * @dont Do not use a radio group for two mutually exclusive actions inline —
 *   that is a SegmentedControl.
 */
export const RadioGroup = Object.assign(
  (props: RadioGroupProps) => {
    const [local, rest] = splitProps(props, ['class']);
    return (
      <KobalteRadioGroup
        class={cn('flex flex-col gap-2', local.class)}
        {...rest}
      />
    );
  },
  {
    Label:
      KobalteRadioGroup.Label /* passthrough — styled via class at use sites */,
    Description:
      KobalteRadioGroup.Description /* passthrough — styled via class at use sites */,
    ErrorMessage:
      KobalteRadioGroup.ErrorMessage /* passthrough — styled via class at use sites */,
    Item: RadioGroupItem,
    ItemInput:
      KobalteRadioGroup.ItemInput /* passthrough — ItemControl already renders one */,
    ItemControl: RadioGroupItemControl,
    ItemIndicator: KobalteRadioGroup.ItemIndicator,
    ItemLabel: RadioGroupItemLabel,
    ItemDescription: KobalteRadioGroup.ItemDescription,
  }
);
