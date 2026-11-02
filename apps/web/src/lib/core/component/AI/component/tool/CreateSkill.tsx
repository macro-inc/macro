import { ItemPreview } from '@core/component/ItemPreview';
import Lightning from '@icon/system/regular/lightning.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

export const createSkillHandler = createToolRenderer({
  name: 'CreateSkill',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);

    return (
      <BaseTool
        icon={Lightning}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <pre class="whitespace-pre-wrap break-words rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
              {ctx.tool.data.markdown}
            </pre>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            <Show
              when={ctx.response?.data.documentId}
              fallback={
                <>
                  Create skill{' '}
                  <span class="text-ink">{ctx.tool.data.skillName}</span>
                </>
              }
            >
              {(documentId) => (
                <>
                  Created skill{' '}
                  <Suspense>
                    <ItemPreview
                      class="inline-flex align-middle ring-0"
                      id={documentId()}
                      type="document"
                    />
                  </Suspense>
                </>
              )}
            </Show>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!ctx.tool.data.markdown}
          />
        </div>
      </BaseTool>
    );
  },
});
