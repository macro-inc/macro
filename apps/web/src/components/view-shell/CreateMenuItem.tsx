import CheckIcon from '@icon/system/regular/check.svg';
import { cn, Dropdown } from '@ui';
import {
  type Component,
  type ComponentProps,
  createUniqueId,
  splitProps,
} from 'solid-js';

type CreateMenuChoice = {
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
};

/** Icon, title, and wrapping description shared by every creation choice. */
function CreateMenuChoiceBody(
  props: CreateMenuChoice & { descriptionId: string }
) {
  return (
    <>
      <props.icon class="mt-0.5 size-5 shrink-0" />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span>{props.title}</span>
        <span
          id={props.descriptionId}
          class="whitespace-normal font-[family-name:Inter_Variable,sans-serif] text-xs font-normal text-ink-extra-muted"
        >
          {props.description}
        </span>
      </span>
    </>
  );
}

/** Creation choices with a concise explanation of when to use each one. */
export function CreateMenuItem(
  props: ComponentProps<typeof Dropdown.Item> & CreateMenuChoice
) {
  const [local, rest] = splitProps(props, [
    'icon',
    'title',
    'description',
    'class',
  ]);
  const descriptionId = createUniqueId();
  return (
    <Dropdown.Item
      {...rest}
      aria-label={local.title}
      aria-describedby={descriptionId}
      class={cn('items-start gap-3 py-3', local.class)}
    >
      <CreateMenuChoiceBody
        icon={local.icon}
        title={local.title}
        description={local.description}
        descriptionId={descriptionId}
      />
    </Dropdown.Item>
  );
}

/** A creation choice picked inside a `Dropdown.RadioGroup`, checked when selected. */
export function CreateMenuRadioItem(
  props: ComponentProps<typeof Dropdown.RadioItem> & CreateMenuChoice
) {
  const [local, rest] = splitProps(props, [
    'icon',
    'title',
    'description',
    'class',
  ]);
  const descriptionId = createUniqueId();
  return (
    <Dropdown.RadioItem
      {...rest}
      aria-label={local.title}
      aria-describedby={descriptionId}
      class={cn('items-start gap-3 py-3', local.class)}
    >
      <CreateMenuChoiceBody
        icon={local.icon}
        title={local.title}
        description={local.description}
        descriptionId={descriptionId}
      />
      <Dropdown.ItemIndicator class="mt-0.75 shrink-0">
        <CheckIcon class="size-3.5 text-accent" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}
