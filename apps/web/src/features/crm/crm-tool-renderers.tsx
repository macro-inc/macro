import { BaseTool } from '@core/component/AI/component/tool/BaseTool';
import { createToolRenderer } from '@core/component/AI/component/tool/ToolRenderer';
import Buildings from '@phosphor-icons/core/regular/buildings.svg';
import { Show } from 'solid-js';
import {
  GetCompanyToolResponse,
  ListCompaniesToolResponse,
  pluralize,
} from './components/tool-companies';

const listCompaniesHandler = createToolRenderer({
  name: 'ListCompanies',
  render: (ctx) => {
    const companies = () => ctx.response?.data.companies ?? [];
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (companies().length === 0) return 'No results';
      return pluralize(companies().length, 'company', 'companies');
    };

    return (
      <BaseTool
        icon={Buildings}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response ? (
            <ListCompaniesToolResponse {...ctx.response.data} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            List CRM companies
            <Show when={ctx.tool.data.search}>
              {(search) => <> matching "{search()}"</>}
            </Show>
            <Show when={ctx.tool.data.stage}>
              {(stage) => <> in stage {stage()}</>}
            </Show>
          </span>
          <Show when={statusText()}>
            {(text) => (
              <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
                {text()}
              </span>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

const getCompanyHandler = createToolRenderer({
  name: 'GetCompany',
  render: (ctx) => {
    const statusText = () => {
      if (!ctx.response) return undefined;
      const data = ctx.response.data;
      return data.stage?.label ?? data.domains[0];
    };

    return (
      <BaseTool
        icon={Buildings}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response ? (
            <GetCompanyToolResponse {...ctx.response.data} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            Read CRM company
            <Show when={ctx.response?.data.name}>
              {(name) => <> {name()}</>}
            </Show>
          </span>
          <Show when={statusText()}>
            {(text) => (
              <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
                {text()}
              </span>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export { getCompanyHandler, listCompaniesHandler };
