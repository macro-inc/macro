import { RadioGroup as KobalteRadioGroup } from '@kobalte/core/radio-group';
import {
  type ComponentProps,
  createContext,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';

export type RadioGroupSize = 'sm' | 'md' | 'lg';
export type RadioGroupVariant = 'list' | 'cards';
export type RadioGroupProps = ComponentProps<typeof KobalteRadioGroup> & {
  size?: RadioGroupSize;
  /** `cards` frames each item as a selectable card that is clickable as a whole. */
  variant?: RadioGroupVariant;
};
type ItemProps = ComponentProps<typeof KobalteRadioGroup.Item>;
type ItemControlProps = ComponentProps<typeof KobalteRadioGroup.ItemControl>;
type ItemIndicatorProps = ComponentProps<
  typeof KobalteRadioGroup.ItemIndicator
>;
type ItemLabelProps = ComponentProps<typeof KobalteRadioGroup.ItemLabel>;
type RadioGroupStyle = { size: RadioGroupSize; variant: RadioGroupVariant };

const RadioGroupStyleContext = createContext(
  (): RadioGroupStyle => ({ size: 'md', variant: 'list' })
);
const radioSizes: Record<
  RadioGroupSize,
  { control: string; indicator: string }
> = {
  sm: { control: 'size-3.5', indicator: 'size-1.5' },
  md: { control: 'size-4', indicator: 'size-2' },
  lg: { control: 'size-5', indicator: 'size-2.5' },
};

function RadioGroupItem(props: ItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  const style = useContext(RadioGroupStyleContext);
  return (
    <KobalteRadioGroup.Item
      class={cn(
        'relative inline-flex items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        style().variant === 'cards' &&
          'items-start gap-3 rounded-lg border border-edge-button bg-control p-3 text-ink-muted transition-colors duration-120 motion-reduce:transition-none not-touch:not-data-checked:not-data-disabled:hover:overlay-hover data-checked:overlay-active data-checked:text-ink has-focus-visible:ring-2 has-focus-visible:ring-edge-focus',
        local.class
      )}
      {...rest}
    />
  );
}

function RadioGroupItemIndicator(props: ItemIndicatorProps) {
  const [local, rest] = splitProps(props, ['class']);
  const style = useContext(RadioGroupStyleContext);
  return (
    <KobalteRadioGroup.ItemIndicator
      class={cn(
        'rounded-full bg-button-accent-ink',
        radioSizes[style().size].indicator,
        local.class
      )}
      {...rest}
    />
  );
}

function RadioGroupItemControl(props: ItemControlProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const style = useContext(RadioGroupStyleContext);
  return (
    <>
      <KobalteRadioGroup.ItemInput class="peer sr-only" />
      <KobalteRadioGroup.ItemControl
        class={cn(
          'inline-grid shrink-0 place-items-center rounded-full border border-border-secondary bg-transparent data-checked:border-accent data-checked:bg-accent data-disabled:cursor-not-allowed data-invalid:border-failure',
          // A card shows focus on its frame instead.
          style().variant === 'list' &&
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          radioSizes[style().size].control,
          local.class
        )}
        {...rest}
      >
        {local.children ?? <RadioGroupItemIndicator />}
      </KobalteRadioGroup.ItemControl>
    </>
  );
}

function RadioGroupItemLabel(props: ItemLabelProps) {
  const [local, rest] = splitProps(props, ['class']);
  const style = useContext(RadioGroupStyleContext);
  return (
    <KobalteRadioGroup.ItemLabel
      class={cn(
        // The label stretches over its card, so a click anywhere on it selects.
        style().variant === 'cards' &&
          'after:absolute after:inset-0 after:rounded-lg',
        local.class
      )}
      {...rest}
    />
  );
}

/**
 * A single choice among related values, with native radio keyboard behavior.
 *
 * @do Name the group with aria-label or RadioGroup.Label.
 * @do Render an ItemLabel for each item, even when the visible text is elsewhere.
 * @do Use the root size prop for compact or larger radio controls.
 * @do Use variant="cards" when each choice needs a title and a description; lay the cards out with grid classes on the root.
 * @dont Add ItemInput yourself; ItemControl already renders one.
 * @dont Use radios for view navigation; use Tabs.
 */
export const RadioGroup = Object.assign(
  (props: RadioGroupProps) => {
    const [local, rest] = splitProps(props, ['class', 'size', 'variant']);
    const variant = () => local.variant ?? 'list';
    return (
      <RadioGroupStyleContext.Provider
        value={() => ({ size: local.size ?? 'md', variant: variant() })}
      >
        <KobalteRadioGroup
          class={cn(
            variant() === 'cards' ? 'grid gap-2' : 'flex flex-col gap-2',
            local.class
          )}
          {...rest}
        />
      </RadioGroupStyleContext.Provider>
    );
  },
  {
    Label: KobalteRadioGroup.Label,
    Description: KobalteRadioGroup.Description,
    ErrorMessage: KobalteRadioGroup.ErrorMessage,
    Item: RadioGroupItem,
    ItemInput: KobalteRadioGroup.ItemInput,
    ItemControl: RadioGroupItemControl,
    ItemIndicator: RadioGroupItemIndicator,
    ItemLabel: RadioGroupItemLabel,
    ItemDescription: KobalteRadioGroup.ItemDescription,
  }
);
