import { cn, Dropdown } from '@ui';
import {
  type Component,
  type ComponentProps,
  createUniqueId,
  splitProps,
} from 'solid-js';

/** Creation choices with a concise explanation of when to use each one. */
export function CreateMenuItem(
  props: ComponentProps<typeof Dropdown.Item> & {
    icon: Component<{ class?: string }>;
    title: string;
    description: string;
  }
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
      <local.icon class="mt-0.5 size-5 shrink-0" />
      <span class="flex min-w-0 flex-col gap-1">
        <span>{local.title}</span>
        <span
          id={descriptionId}
          class="whitespace-normal font-[family-name:Inter_Variable,sans-serif] text-xs font-normal text-ink-extra-muted"
        >
          {local.description}
        </span>
      </span>
    </Dropdown.Item>
  );
}
