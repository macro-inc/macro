import { NIL_UUID } from '@app/component/next-soup/filters/filter-store';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useCompanyQuery } from '@queries/crm/companies';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { type JSX, Show } from 'solid-js';

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-ink-muted">{props.label}</span>
      <div class="text-sm">{props.children}</div>
    </div>
  );
}

export function ContactMetadataSection(props: {
  contact?: CrmContactResponse;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  // NIL while the contact is loading — useCompanyQuery's `enabled` gate
  // excludes it, so no doomed 404 fires before the real companyId arrives.
  const { company } = useCompanyQuery(
    () => props.contact?.companyId ?? NIL_UUID
  );

  const openCompany = (companyId: string) => {
    replaceOrInsertSplit({ type: 'company', id: companyId });
  };

  return (
    <Show
      when={props.contact}
      fallback={<div class="text-sm text-ink-muted">Loading…</div>}
    >
      {(contact) => (
        <div class="flex flex-col gap-3">
          <Field label="Email">
            <span class="truncate">{contact().email}</span>
          </Field>
          <Field label="Company">
            <button
              type="button"
              onClick={() => openCompany(contact().companyId)}
              class="text-left text-sm text-accent hover:underline"
            >
              {company()?.name ?? 'Open company'}
            </button>
          </Field>
        </div>
      )}
    </Show>
  );
}
