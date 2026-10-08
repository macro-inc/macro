import {
  Entity,
  isCrmContactEntity,
  MultiSelectCheckbox,
  UnreadIndicator,
} from '@entity';
import type {
  BaseListEntityProps,
  LayoutProps,
} from '@entity/composed/list-entity/shared';
import BuildingsIcon from '@phosphor/buildings.svg';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { contactGridTemplate } from '../components/contact-grid-template';
import { CrmListRow } from './record-row';

/** People row: name and email, company, and last interaction. */
function ContactGridLayout(props: LayoutProps) {
  const contact = () =>
    isCrmContactEntity(props.entity) ? props.entity : undefined;
  return (
    <Entity.Layout
      class="w-full min-h-[inherit] items-center text-sm px-2 gap-2 grid grid-rows-[1fr]"
      style={contactGridTemplate(!!props.hideCheckbox)}
    >
      <Show when={!props.hideCheckbox}>
        <Entity.Slot placement="indicator" class="relative size-full group">
          <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
            <UnreadIndicator active={props.unread} />
          </div>
          <div
            class={cn(
              'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
              { 'opacity-100': props.checked }
            )}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </div>
        </Entity.Slot>
      </Show>

      <Entity.Slot
        placement="content"
        class="ph-no-capture font-medium truncate items-center gap-2 flex min-w-0"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>
        <span class="truncate min-w-0">
          <Entity.Title entity={props.entity} />
        </span>
        <Show when={contact()?.email !== contact()?.name && contact()?.email}>
          {(email) => (
            <span class="truncate shrink-[2] min-w-0 text-xs font-normal text-ink-extra-muted">
              {email()}
            </span>
          )}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="company"
        class="ph-no-capture flex items-center gap-1.5 min-w-0 text-xs text-ink-muted"
      >
        <Show when={contact()?.companyName}>
          {(companyName) => (
            <>
              <BuildingsIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
              <span class="truncate">{companyName()}</span>
            </>
          )}
        </Show>
      </Entity.Slot>

      {/* Contacts sort by last interaction, which `sortTs` carries. */}
      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light"
      >
        <Entity.Timestamp entity={props.entity} />
      </Entity.Slot>
    </Entity.Layout>
  );
}

/** People-list row for a CRM contact. */
export function ContactListEntity(props: BaseListEntityProps) {
  return <CrmListRow {...props} layout={ContactGridLayout} />;
}
