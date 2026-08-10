import { ItemPreview } from '@core/component/ItemPreview';
import FolderPlus from '@phosphor-icons/core/regular/folder-plus.svg';
import { Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'CreateProject',
  render: (ctx) => (
    <BaseTool icon={FolderPlus} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Create folder <span class="text-ink">{ctx.tool.data.projectName}</span>
        <Show when={ctx.response}>
          {(response) => (
            <>
              {' '}
              <span class="text-ink-placeholder">·</span>{' '}
              <Suspense>
                <ItemPreview
                  class="inline-flex align-middle ring-0"
                  id={response().data.projectId}
                  type="project"
                />
              </Suspense>
            </>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const createProjectHandler = handler;
