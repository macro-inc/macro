import BuildingOffice from '@phosphor/building-office.svg';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { dealStages, type SampleCompany } from '../../core/workspace-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { SearchBar } from '../email/frozen/SearchBar';
import { CompanyRecord, type CompanySection, StageIcon } from './CompanyRecord';

export type { CompanySection } from './CompanyRecord';

/** Last Interaction, newest first: today's times, then earlier dates. */
const recency = (updated = '') => {
  const time = /^(\d+):(\d+) (AM|PM)$/.exec(updated);
  if (time)
    return (
      1e14 +
      ((Number(time[1]) % 12) + (time[3] === 'PM' ? 12 : 0)) * 60 +
      Number(time[2])
    );
  const date = Date.parse(`${updated} 2026`);
  return Number.isNaN(date) ? 0 : date;
};
const byRecency = (a: SampleCompany, b: SampleCompany) =>
  recency(b.updated) - recency(a.updated);

/**
 * The Customers view: a stage board (or list) of companies, and the company
 * record from crm/views/record-detail. Walkthroughs can drive the record's
 * tab with `section` and keep linked items inside their own frame with
 * `onOpenItem`.
 */
export function WorkspaceCompanies(props: {
  workspace: DummyWorkspace;
  /** The floating details panel is closed by default, as in the app. */
  initialPanelOpen?: boolean;
  section?: CompanySection;
  onSectionChange?: (section: CompanySection) => void;
  onOpenItem?: (view: WorkspaceView, id: string) => void;
}) {
  const w = props.workspace;
  const selected = () => w.data.companies.find((c) => c.id === w.selected());
  const [panel, setPanel] = createSignal(props.initialPanelOpen ?? false);
  const [localSection, setLocalSection] =
    createSignal<CompanySection>('overview');
  createEffect(on(w.selected, () => setLocalSection('overview')));
  const open = (id: string) => {
    w.setData('companies', (c) => c.id === id && !!c.unread, 'unread', false);
    w.open('crm', id);
  };
  const companies = () =>
    w.data.companies.filter(
      (c) =>
        `${c.name} ${c.domain}`
          .toLowerCase()
          .includes(w.query().toLowerCase()) &&
        (w.companyFilter() !== 'My companies' || c.owner === 'jacob') &&
        (w.companyFilter() !== 'Unassigned' || !c.owner) &&
        (w.companyFilter() !== 'Needs follow-up' || c.stage === 'Lead') &&
        (w.companyFilter() !== 'Recently active' || !!c.updated?.includes(':'))
    );
  return (
    <Show
      when={selected()}
      fallback={
        <>
          <div class="sample-company-titlebar">
            <h1>
              <span class="truncate">{w.companyFilter()}</span>
            </h1>
          </div>
          <div class="sample-company-search">
            <SearchBar
              label="Search companies"
              placeholder="Search companies"
              value={w.query()}
              onValueChange={w.setQuery}
              class="max-w-md"
            />
          </div>
          <Show
            when={w.companyLayout() === 'Board'}
            fallback={
              <div class="dummy-scroll sample-company-rows">
                <div class="sample-company-row" data-header>
                  <span />
                  <span>Customer</span>
                  <span>Stage</span>
                  <span>Owner</span>
                  <span>Revenue</span>
                  <span>Last Interaction</span>
                </div>
                <For each={[...companies()].sort(byRecency)}>
                  {(c) => (
                    <button
                      class="sample-company-row"
                      type="button"
                      data-company-row={c.id}
                      data-unread={c.unread ? 'true' : undefined}
                      onClick={() => open(c.id)}
                    >
                      <span class="sample-company-row-indicator">
                        <Show when={c.unread}>
                          <span class="size-1.5 rounded-full bg-accent" />
                        </Show>
                      </span>
                      <span class="sample-company-row-content">
                        <BuildingOffice class="size-4 shrink-0" />
                        <span class="truncate">{c.name}</span>
                        <span class="sample-company-row-domain truncate">
                          {c.domain}
                        </span>
                      </span>
                      <span class="sample-company-row-value">
                        <Show when={c.stage !== 'No stage'}>
                          <StageIcon stage={c.stage} />
                          <span class="truncate">{c.stage}</span>
                        </Show>
                      </span>
                      <span class="sample-company-row-value">
                        <Show when={c.owner || undefined}>
                          {(owner) => (
                            <>
                              <img
                                class="size-4 shrink-0 rounded-full object-cover"
                                src={homepagePeople[owner()].photo}
                                alt=""
                              />
                              <span class="truncate">
                                {homepagePeople[owner()].shortName}
                              </span>
                            </>
                          )}
                        </Show>
                      </span>
                      <span class="sample-company-row-value">{c.revenue}</span>
                      <span class="sample-company-row-time">{c.updated}</span>
                    </button>
                  )}
                </For>
              </div>
            }
          >
            <div class="sample-company-board">
              <For each={dealStages}>
                {(stage) => (
                  <section
                    aria-label={stage}
                    class="sample-company-column"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer?.getData('text/plain');
                      if (id)
                        w.setData(
                          'companies',
                          (c) => c.id === id,
                          'stage',
                          stage
                        );
                    }}
                  >
                    <h3>
                      <StageIcon stage={stage} class="size-3.5" />
                      <span class="truncate">{stage}</span>
                    </h3>
                    <For each={companies().filter((c) => c.stage === stage)}>
                      {(c) => (
                        <button
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer?.setData('text/plain', c.id)
                          }
                          type="button"
                          class="sample-company-card"
                          onClick={() => open(c.id)}
                        >
                          <span class="flex min-w-0 items-center gap-2">
                            <BuildingOffice class="size-4 shrink-0" />
                            <strong class="truncate">{c.name}</strong>
                            <Show when={c.owner || undefined}>
                              {(owner) => (
                                <img
                                  class="sample-company-owner"
                                  src={homepagePeople[owner()].photo}
                                  alt={homepagePeople[owner()].name}
                                />
                              )}
                            </Show>
                          </span>
                          <span class="flex min-w-0 items-center gap-2 text-xs text-ink-extra-muted">
                            <span class="truncate">{c.domain}</span>
                            <span class="ml-auto shrink-0">{c.updated}</span>
                          </span>
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </>
      }
    >
      {(company) => (
        <CompanyRecord
          workspace={w}
          company={company()}
          section={props.section ?? localSection()}
          onSectionChange={(section) => {
            setLocalSection(section);
            props.onSectionChange?.(section);
          }}
          panelOpen={panel()}
          onPanelChange={setPanel}
          onOpenItem={props.onOpenItem ?? ((view, id) => w.open(view, id))}
        />
      )}
    </Show>
  );
}
