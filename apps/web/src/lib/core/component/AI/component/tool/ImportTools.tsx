import TrayArrowDown from '@phosphor-icons/core/regular/tray-arrow-down.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

/*
 * Renderers for the import-ledger tools the chat agent can call
 * (CreateImportEntity / DeleteImportEntity / ListImportEntities). The tools
 * only move ledger rows — entity creation happens server-side — so the
 * renders are one-line summaries.
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
