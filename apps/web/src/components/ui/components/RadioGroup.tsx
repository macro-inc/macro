import { RadioGroup as KobalteRadioGroup } from '@kobalte/core/radio-group';
import {
  type ComponentProps,
  createContext,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';

export type RadioGroupSize = 'sm' | 'md' | 'lg';
export type RadioGroupProps = ComponentProps<typeof KobalteRadioGroup> & {
  size?: RadioGroupSize;
};
type ItemProps = ComponentProps<typeof KobalteRadioGroup.Item>;
type ItemControlProps = ComponentProps<typeof KobalteRadioGroup.ItemControl>;
type ItemIndicatorProps = ComponentProps<
  typeof KobalteRadioGroup.ItemIndicator
>;
type ItemLabelProps = ComponentProps<typeof KobalteRadioGroup.ItemLabel>;

const RadioGroupSizeContext = createContext((): RadioGroupSize => 'md');
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
  return (
    <KobalteRadioGroup.Item
      class={cn(
        'relative inline-flex items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        local.class
      )}
      {...rest}
    />
  );
}

function RadioGroupItemIndicator(props: ItemIndicatorProps) {
  const [local, rest] = splitProps(props, ['class']);
  const size = useContext(RadioGroupSizeContext);
  return (
    <KobalteRadioGroup.ItemIndicator
      class={cn(
        'rounded-full bg-button-primary-ink',
        radioSizes[size()].indicator,
        local.class
      )}
      {...rest}
    />
  );
}

function RadioGroupItemControl(props: ItemControlProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const size = useContext(RadioGroupSizeContext);
  return (
    <>
      <KobalteRadioGroup.ItemInput class="peer sr-only" />
      <KobalteRadioGroup.ItemControl
        class={cn(
          'inline-grid shrink-0 place-items-center rounded-full border border-border-secondary bg-transparent data-checked:border-accent data-checked:bg-accent data-disabled:cursor-not-allowed data-invalid:border-failure peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          radioSizes[size()].control,
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
  return <KobalteRadioGroup.ItemLabel class={cn(local.class)} {...rest} />;
}

/**
 * A single choice among related values, with native radio keyboard behavior.
 *
 * @do Name the group with aria-label or RadioGroup.Label.
 * @do Render an ItemLabel for each item, even when the visible text is elsewhere.
 * @do Use the root size prop for compact or larger radio controls.
 * @dont Add ItemInput yourself; ItemControl already renders one.
 * @dont Use radios for view navigation; use Tabs.
 */
export const RadioGroup = Object.assign(
  (props: RadioGroupProps) => {
    const [local, rest] = splitProps(props, ['class', 'size']);
    return (
      <RadioGroupSizeContext.Provider value={() => local.size ?? 'md'}>
        <KobalteRadioGroup
          class={cn('flex flex-col gap-2', local.class)}
          {...rest}
        />
      </RadioGroupSizeContext.Provider>
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
