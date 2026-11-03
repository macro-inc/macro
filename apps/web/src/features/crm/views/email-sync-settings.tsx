import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import GlobeIcon from '@icon/system/regular/globe.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Button, ToggleSwitch, Tooltip } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import {
  type CompanyOption,
  CompanySelect,
} from '../components/company-select';
import { useCrmContext } from '../context/crm-context';
import { isCompanyDomain } from '../core/pipeline-record';
import {
  useBlockedDomains,
  useIsTeamAdmin,
  useQuickAccessCrmCompaniesQuery,
  useTeamCrmConfig,
} from './use-crm';

function PersonalEmailsRow() {
  const isTeamAdmin = useIsTeamAdmin();
  const settings = useTeamCrmConfig();
  const excluded = () => settings.config().excludePersonalEmails ?? true;
  return (
    <SettingsRow
      label="Keep personal emails out"
      description={
        isTeamAdmin()
          ? 'Leave out people who email from gmail.com, outlook.com, and other personal providers. When off, they are added as people without a company.'
          : 'Leave out people who email from gmail.com, outlook.com, and other personal providers. Only team admins can change this.'
      }
    >
      <Show when={settings.update.isPending}>
        <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
      </Show>
      <ToggleSwitch
        size="md"
        label="Keep personal emails out"
        labelClass="sr-only"
        checked={excluded()}
        disabled={
          !isTeamAdmin() || settings.isLoading() || settings.update.isPending
        }
        onChange={(next) =>
          settings.update.mutate({ excludePersonalEmails: next })
        }
      />
    </SettingsRow>
  );
}

/** Companies with a domain; blocking one blocks every domain it has. */
function BlockCompanySelect(props: { onBlock(domains: string[]): void }) {
  const suggestions = useQuickAccessCrmCompaniesQuery();
  const options = createMemo(() =>
    suggestions.companies().flatMap((company) =>
      company.domains[0]
        ? [
            {
              id: company.id,
              name: company.name,
              domain: company.domains[0].domain,
            },
          ]
        : []
    )
  );
  const domainsOf = (option: CompanyOption) =>
    suggestions
      .companies()
      .find((company) => company.id === option.id)
      ?.domains.map((entry) => entry.domain) ?? [];
  return (
    <CompanySelect
      id="block-company"
      companies={options()}
      value={undefined}
      onChange={(option) => props.onBlock(domainsOf(option))}
      loading={suggestions.query.isLoading}
    />
  );
}

function BlockedDomainsRows() {
  const { feedback } = useCrmContext();
  const isTeamAdmin = useIsTeamAdmin();
  const blocked = useBlockedDomains();
  const [draft, setDraft] = createSignal('');
  const domain = () => draft().trim().toLowerCase();
  const pending = () => blocked.setBlocked.isPending;

  const setBlocked = (value: string, isBlocked: boolean) =>
    blocked.setBlocked.mutate(
      { domain: value, blocked: isBlocked },
      {
        onSuccess: () => {
          if (isBlocked && value === domain()) setDraft('');
        },
        onError: () =>
          feedback.failure(
            isBlocked
              ? `Could not block ${value}. Try again.`
              : `Could not unblock ${value}. Try again.`
          ),
      }
    );

  const addDraft = () => {
    if (!isCompanyDomain(domain()) || pending()) return;
    setBlocked(domain(), true);
  };

  return (
    <>
      <SettingsRow
        label="Blocked domains"
        description="Email sync skips these domains and hides their companies and people. A company stays hidden until all its blocked domains are removed."
        stackOnNarrow
      />
      <Switch>
        <Match when={blocked.isError()}>
          <div class="px-4 py-3 text-sm text-ink-muted">
            Blocked domains could not be loaded. Reload to try again.
          </div>
        </Match>
        <Match when={blocked.isPending()}>
          <div class="px-4 py-3">
            <ListSkeleton.Bar class="h-4 w-32" />
          </div>
        </Match>
        <Match when={true}>
          <For
            each={blocked.domains()}
            fallback={
              <div class="px-4 py-3 text-sm text-ink-muted">
                No blocked domains.
              </div>
            }
          >
            {(entry) => (
              <div class="flex min-h-12 items-center gap-3 px-4 py-2">
                <GlobeIcon class="size-3.5 shrink-0 text-ink-muted" />
                <span class="min-w-0 flex-1 truncate text-sm text-ink">
                  {entry}
                </span>
                <Show when={isTeamAdmin()}>
                  <Tooltip label="Unblock">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Unblock ${entry}`}
                      disabled={pending()}
                      onClick={() => setBlocked(entry, false)}
                    >
                      <TrashIcon class="size-3.5" />
                    </Button>
                  </Tooltip>
                </Show>
              </div>
            )}
          </For>
          <Show when={isTeamAdmin()}>
            <div class="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2">
              <input
                type="text"
                value={draft()}
                aria-label="Domain to block"
                placeholder="Block a domain, like acme.com"
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addDraft();
                }}
                class="settings-input min-w-40 flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                disabled={!isCompanyDomain(domain()) || pending()}
                onClick={addDraft}
              >
                Block
              </Button>
              <BlockCompanySelect
                onBlock={(domains) => {
                  for (const value of domains) setBlocked(value, true);
                }}
              />
            </div>
          </Show>
        </Match>
      </Switch>
    </>
  );
}

/** Team controls over what email sync brings into the CRM. */
export function EmailSyncSection() {
  return (
    <SettingsSection title="Email sync">
      <SettingsCard>
        <PersonalEmailsRow />
        <BlockedDomainsRows />
      </SettingsCard>
    </SettingsSection>
  );
}
