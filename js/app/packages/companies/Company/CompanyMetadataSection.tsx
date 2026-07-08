import { type CrmCompanyEntity, formatDateAndTime } from '@entity';
import { For, type JSX, Show } from 'solid-js';

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-ink-muted">{props.label}</span>
      <div class="text-sm">{props.children}</div>
    </div>
  );
}

export function CompanyMetadataSection(props: { company?: CrmCompanyEntity }) {
  return (
    <Show
      when={props.company}
      fallback={<div class="text-sm text-ink-muted">Loading…</div>}
    >
      {(company) => (
        <div class="flex flex-col gap-3">
          <Field label="Domains">
            <For
              each={company().domains}
              fallback={<span class="text-ink-muted">None</span>}
            >
              {(domain) => <div class="truncate">{domain.domain}</div>}
            </For>
          </Field>
          {/* `updatedAt` carries `crm_companies.last_interaction`, which the
              backend keeps fresh from synced workspace emails. */}
          <Field label="Last interaction">
            <Show
              when={company().updatedAt}
              fallback={<span class="text-ink-muted">None</span>}
            >
              {(ts) => <span>{formatDateAndTime(ts())}</span>}
            </Show>
          </Field>
        </div>
      )}
    </Show>
  );
}
