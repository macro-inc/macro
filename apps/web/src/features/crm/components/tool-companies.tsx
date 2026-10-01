import { Tool } from '@core/component/AI/component/tool/Tool';
import Buildings from '@phosphor-icons/core/regular/buildings.svg';
import { For, Show } from 'solid-js';

type CompanyListItem = {
  id: string;
  name?: string | null;
  domains: string[];
  stage?: { label: string } | null;
};
type ListCompaniesResponse = { companies: CompanyListItem[] };
type GetCompanyResponse = CompanyListItem & {
  description?: string | null;
  ownerUserId?: string | null;
  revenue?: number | null;
  contacts: unknown[];
};

export const pluralize = (
  count: number,
  singular: string,
  plural = `${singular}s`
) => `${count} ${count === 1 ? singular : plural}`;

function companySubtitle(company: CompanyListItem) {
  const parts: string[] = [];
  const domain = company.domains[0];
  if (domain) parts.push(domain);
  if (company.stage) parts.push(company.stage.label);
  return parts.join(' · ');
}

function CompanyRow(props: { company: CompanyListItem }) {
  return (
    <Tool.ListItem icon={<Buildings class="size-4" />}>
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs text-ink">
          {props.company.name ?? props.company.domains[0] ?? props.company.id}
        </div>
        <Show when={companySubtitle(props.company)}>
          {(subtitle) => (
            <div class="truncate text-xs text-ink-placeholder">
              {subtitle()}
            </div>
          )}
        </Show>
      </div>
    </Tool.ListItem>
  );
}

export function ListCompaniesToolResponse(props: ListCompaniesResponse) {
  return (
    <Tool.List>
      <Show
        when={props.companies.length > 0}
        fallback={<Tool.ListItem>No matching CRM companies.</Tool.ListItem>}
      >
        <For each={props.companies}>
          {(company) => <CompanyRow company={company} />}
        </For>
      </Show>
    </Tool.List>
  );
}

export function GetCompanyToolResponse(props: GetCompanyResponse) {
  const details = () => {
    const rows: { label: string; value: string }[] = [];
    if (props.domains.length > 0) {
      rows.push({ label: 'Domains', value: props.domains.join(', ') });
    }
    if (props.stage) rows.push({ label: 'Stage', value: props.stage.label });
    if (props.ownerUserId) {
      rows.push({ label: 'Owner', value: props.ownerUserId });
    }
    if (props.revenue !== undefined && props.revenue !== null) {
      rows.push({ label: 'Revenue', value: `$${props.revenue}` });
    }
    rows.push({
      label: 'Contacts',
      value: pluralize(props.contacts.length, 'contact'),
    });
    return rows;
  };

  return (
    <Tool.List>
      <Tool.ListItem icon={<Buildings class="size-4" />}>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs text-ink">
            {props.name ?? props.domains[0] ?? props.id}
          </div>
          <Show when={props.description}>
            {(description) => (
              <div class="truncate text-xs text-ink-placeholder">
                {description()}
              </div>
            )}
          </Show>
        </div>
      </Tool.ListItem>
      <For each={details()}>
        {(row) => (
          <Tool.ListItem>
            <div class="flex min-w-0 flex-1 gap-2 text-xs">
              <span class="shrink-0 text-ink-placeholder">{row.label}</span>
              <span class="min-w-0 truncate text-ink">{row.value}</span>
            </div>
          </Tool.ListItem>
        )}
      </For>
    </Tool.List>
  );
}
