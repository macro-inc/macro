import { For } from 'solid-js';
import { CRM_DEMO_COMPANIES } from '../core/crm-demo';
import {
  CompanyKanbanCardSurface,
  CompanyKanbanColumn,
} from './DemoCompanyKanban';
import { CrmStageIcon } from './DemoStageIcon';

const STAGES = ['Qualified', 'Proposal', 'Closed won'];

/** The app's CRM board and cards, with fixture data and the detail panel closed. */
export default function HomepageWorkspaceCrm() {
  return (
    <div
      class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4"
      aria-label="Sample customer pipeline"
    >
      <For each={STAGES}>
        {(stage, index) => (
          <CompanyKanbanColumn
            label={stage}
            icon={<CrmStageIcon optionId={stage} index={index()} />}
          >
            <For
              each={CRM_DEMO_COMPANIES.filter(
                (company) => Number(company.stage) === index()
              )}
            >
              {(company) => (
                <CompanyKanbanCardSurface
                  icon={
                    <span class="text-xs font-semibold text-accent">
                      {company.initials}
                    </span>
                  }
                  title={company.name}
                  domain={<span class="truncate">{company.domain}</span>}
                  updatedAt={<span class="ml-auto shrink-0">Sep 24</span>}
                />
              )}
            </For>
          </CompanyKanbanColumn>
        )}
      </For>
    </div>
  );
}
