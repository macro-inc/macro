import TrayArrowDown from '@phosphor-icons/core/regular/tray-arrow-down.svg';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/*
 * Renderers for the import-ledger tools the chat agent can call
 * (CreateImportEntity / ImportNotionPage / DeleteImportEntity /
 * ListImportEntities).
 */

/** Human label for the item a call is about, from its source metadata. */
function itemLabel(metadata: { [k: string]: unknown }): string | undefined {
  for (const key of ['title', 'name', 'identifier']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export const createImportEntityHandler = createToolRenderer({
  name: 'CreateImportEntity',
  render: (ctx) => (
    <BaseTool
      icon={TrayArrowDown}
      renderContext={ctx.renderContext}
      type="call"
    >
      <div class="min-w-0 flex-1 truncate">
        {ctx.tool.data.status === 'imported' ? 'Record import of' : 'Stage'}{' '}
        <span class="text-ink">
          {itemLabel(ctx.tool.data.metadata) ?? ctx.tool.data.foreignId}
        </span>
      </div>
    </BaseTool>
  ),
});

export const importNotionPageHandler = createToolRenderer({
  name: 'ImportNotionPage',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const hasResponse = () => ctx.response !== undefined;
    const status = () =>
      match(ctx.response?.data.outcome)
        .with('imported', () => 'Imported')
        .with(
          'already_imported',
          'already_imported_by_teammate',
          () => 'Already imported'
        )
        .with('previously_declined', () => 'Previously declined')
        .with('import_in_progress', () => 'Importing')
        .otherwise(() => undefined);

    return (
      <BaseTool
        icon={TrayArrowDown}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResponse() && isExpanded() ? (
            <div class="rounded-md bg-panel px-3 py-2 text-xs text-ink-muted">
              {ctx.response?.data.message}
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <div class="min-w-0 flex-1 truncate">
            Import Notion page{' '}
            <span class="text-ink">{ctx.tool.data.pageUrl}</span>
          </div>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResponse()}
            status={status()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const deleteImportEntityHandler = createToolRenderer({
  name: 'DeleteImportEntity',
  render: (ctx) => (
    <BaseTool
      icon={TrayArrowDown}
      renderContext={ctx.renderContext}
      type="call"
    >
      Decline an import candidate
    </BaseTool>
  ),
});

export const listImportEntitiesHandler = createToolRenderer({
  name: 'ListImportEntities',
  render: (ctx) => (
    <BaseTool
      icon={TrayArrowDown}
      renderContext={ctx.renderContext}
      type="call"
    >
      List import candidates
    </BaseTool>
  ),
});
