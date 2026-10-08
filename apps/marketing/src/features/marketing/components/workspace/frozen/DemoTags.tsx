import Plus from '@phosphor/plus.svg';
import { Dropdown } from '@ui';
import { badgeTriggerClasses } from '@ui/components/Badge';
import { For, type JSX } from 'solid-js';

// Colors from property/tags/tagColors; dot and pill from TagDot / TagPill.
const DEMO_TAGS = [
  { label: 'Launch', color: '#F5D90A' },
  { label: 'Product', color: '#0091FF' },
  { label: 'Customers', color: '#E93D82' },
  { label: 'Design', color: '#8E4EC6' },
  { label: 'Engineering', color: '#46A758' },
  { label: 'Follow up', color: '#F76B15' },
] as const;

export function TagDot(props: {
  label: string;
  options?: readonly { label: string; color: string }[];
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="tag-dot"
      class="inline-block size-2.5 shrink-0 rounded-full"
      style={{
        'background-color':
          (props.options ?? DEMO_TAGS).find((tag) => tag.label === props.label)
            ?.color ?? '#889096',
      }}
    />
  );
}

export function DemoTags(props: {
  tags: readonly string[];
  options?: readonly { label: string; color: string }[];
  onChange: (tags: string[]) => void;
}) {
  const picker = (label: string, children: JSX.Element) => (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        aria-label={label}
        noTouchResize
        class={badgeTriggerClasses({
          size: 'sm',
          class: 'min-w-0 gap-1.5 border-0 bg-transparent text-ink-muted',
        })}
      >
        {children}
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
          <Dropdown.GroupLabel>Tags</Dropdown.GroupLabel>
          <For each={props.options ?? DEMO_TAGS}>
            {(tag) => (
              <Dropdown.CheckboxItem
                checked={props.tags.includes(tag.label)}
                onChange={(checked) =>
                  props.onChange(
                    checked
                      ? [...new Set([...props.tags, tag.label])]
                      : props.tags.filter((item) => item !== tag.label)
                  )
                }
              >
                <TagDot label={tag.label} options={props.options} />
                {tag.label}
              </Dropdown.CheckboxItem>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
  return (
    <div class="flex flex-wrap items-center gap-1" aria-label="Tags">
      <For each={props.tags}>
        {(tag) =>
          picker(
            `Change tag ${tag}`,
            <>
              <TagDot label={tag} options={props.options} />
              <span class="min-w-0 truncate">{tag}</span>
            </>
          )
        }
      </For>
      {picker('Add tags', <Plus class="size-3.5" />)}
    </div>
  );
}
