import CalendarIcon from '@phosphor/calendar-blank.svg';
import CheckIcon from '@phosphor/check-square.svg';
import HashIcon from '@phosphor/hash.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import TagIcon from '@phosphor/tag.svg';
import TextIcon from '@phosphor/text-t.svg';
import { PropertyDataTypeIcon } from '@property/utils/PropertyDataTypeIcon';
import { Match, Switch } from 'solid-js';
import type { DatabaseEntityType } from '../core/column-inference';

export function PropertyIcon(props: {
  type: string;
  entityType?: DatabaseEntityType | null;
  relation?: boolean;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={props.class ?? 'size-3.5 shrink-0 text-ink-muted'}
    >
      <Switch fallback={<TextIcon class="size-full" />}>
        <Match when={props.relation}>
          <LinkIcon class="size-full" />
        </Match>
        <Match when={props.type === 'NUMBER'}>
          <HashIcon class="size-full" />
        </Match>
        <Match when={props.type === 'BOOLEAN'}>
          <CheckIcon class="size-full" />
        </Match>
        <Match when={props.type === 'DATE'}>
          <CalendarIcon class="size-full" />
        </Match>
        <Match when={props.type === 'LINK'}>
          <LinkIcon class="size-full" />
        </Match>
        <Match
          when={
            props.type === 'SELECT_STRING' || props.type === 'SELECT_NUMBER'
          }
        >
          <ListIcon class="size-full" />
        </Match>
        <Match when={props.type === 'ENTITY'}>
          <PropertyDataTypeIcon
            property={{
              valueType: 'ENTITY',
              specificEntityType: props.entityType,
            }}
            class="size-full"
          />
        </Match>
        <Match when={props.type === 'TAG'}>
          <TagIcon class="size-full" />
        </Match>
      </Switch>
    </span>
  );
}
