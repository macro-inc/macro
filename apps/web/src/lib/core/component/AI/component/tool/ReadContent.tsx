import { EntityIcon } from '@core/component/EntityIcon';
import { ItemPreview } from '@core/component/ItemPreview';
import Newspaper from '@phosphor-icons/core/regular/newspaper.svg';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import { Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadContent',
  render: (ctx) => {
    // System skills have no document behind them, so the item preview would
    // report them deleted — render the static skill name instead.
    const systemSkills = useSystemSkillsQuery();
    return (
      <BaseTool icon={Newspaper} renderContext={ctx.renderContext} type="call">
        <div class="min-w-0 flex-1">
          <Show
            when={systemSkills.getSystemSkill(ctx.tool.data.documentId)}
            fallback={
              <>
                Read <span class="text-ink">document</span>{' '}
                <span class="text-ink-placeholder">·</span>{' '}
                <Suspense>
                  <ItemPreview
                    class="inline-flex align-middle ring-0"
                    id={ctx.tool.data.documentId}
                    type="document"
                  />
                </Suspense>
              </>
            }
          >
            {(skill) => (
              <>
                Read <span class="text-ink">skill</span>{' '}
                <span class="text-ink-placeholder">·</span>{' '}
                <span class="inline-flex items-center gap-1 align-middle text-ink">
                  <EntityIcon targetType="skill" size="xs" />
                  {skill().name}
                </span>
              </>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const readContentHandler = handler;
