import PlusCircle from '@phosphor/plus-circle.svg';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

const DATA_TYPE_LABELS: Record<string, string> = {
  string: 'text',
  number: 'number',
  boolean: 'checkbox',
  date: 'date',
  select: 'select',
  select_string: 'select',
  select_number: 'select',
  entity: 'entity',
  link: 'link',
};

const handler = createToolRenderer({
  name: 'CreateCustomProperty',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const displayName = () =>
      ctx.response?.data.displayName ?? ctx.tool.data.display_name;
    const dataType = () =>
      ctx.response?.data.dataType ?? ctx.tool.data.data_type;
    const typeLabel = () => DATA_TYPE_LABELS[dataType()] ?? dataType();
    const scopeLabel = () => {
      const scope = ctx.response?.data.scope ?? ctx.tool.data.scope ?? 'team';
      return scope === 'user' ? 'personal' : 'team';
    };
    const options = () => ctx.response?.data.options ?? [];
    const hasDetails = () => ctx.response != null;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (options().length === 1) return '1 option';
      if (options().length > 1) return `${options().length} options`;
      return typeLabel();
    };

    return (
      <BaseTool
        icon={PlusCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasDetails() && isExpanded() ? (
            <Tool.List>
              <Tool.ListItem>
                <span class="text-ink-muted">id</span>
                <span class="ml-2 truncate font-mono text-2xs text-ink">
                  {ctx.response?.data.propertyDefinitionId}
                </span>
              </Tool.ListItem>
              <Show when={options().length > 0}>
                <For each={options()}>
                  {(option) => (
                    <Tool.ListItem>
                      <span class="truncate text-ink">
                        {option.displayValue}
                      </span>
                    </Tool.ListItem>
                  )}
                </For>
              </Show>
            </Tool.List>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="shrink-0">
              {ctx.response ? 'Created property' : 'Create property'}
            </span>
            <span class="truncate text-ink">{displayName()}</span>
            <span class="shrink-0 text-ink-placeholder">·</span>
            <span class="shrink-0">{typeLabel()}</span>
            <span class="shrink-0 text-ink-placeholder">·</span>
            <span class="shrink-0">{scopeLabel()}</span>
          </div>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasDetails()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const createCustomPropertyHandler = handler;
