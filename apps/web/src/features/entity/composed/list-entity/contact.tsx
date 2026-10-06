import { Show } from 'solid-js';
import type { CrmContactEntity } from '../../types/entity';

/** A contact found by email alone would otherwise show only an unrelated name. */
export function ContactEmail(props: { entity: CrmContactEntity }) {
  return (
    <Show when={props.entity.name && props.entity.name !== props.entity.email}>
      <span class="min-w-0 truncate font-normal text-ink-extra-muted">
        {props.entity.email}
      </span>
    </Show>
  );
}
