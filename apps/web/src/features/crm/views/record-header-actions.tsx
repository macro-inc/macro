import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { Show } from 'solid-js';
import type { CrmRecordRef } from '../core/record';
import { CompanyVisibilityButton } from './company-visibility-button';
import { ContactVisibilityButton } from './contact-visibility-button';
import { CrmCopyLinkButton } from './copy-link-button';

export function RecordHeaderActions(props: { record: CrmRecordRef }) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
      <HeaderActionGroup
        label={
          props.record.type === 'contact'
            ? 'Contact actions'
            : 'Company actions'
        }
      >
        <CrmCopyLinkButton
          grouped
          type={props.record.type}
          id={props.record.id}
        />
        <Show when={props.record.type === 'company' && props.record.id} keyed>
          {(id) => <CompanyVisibilityButton grouped companyId={id} />}
        </Show>
        <Show when={props.record.type === 'contact' && props.record.id} keyed>
          {(id) => <ContactVisibilityButton grouped contactId={id} />}
        </Show>
      </HeaderActionGroup>
      <SidePanel.Toggle />
    </div>
  );
}
