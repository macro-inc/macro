import Stack from '@phosphor-icons/core/regular/stack.svg';
import type { ToolName } from '@service-cognition/generated/tools/tool';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/** Keep project tool results inspectable before native project views are available. */
function initiativeHandler<TName extends ToolName>(name: TName, label: string) {
  return createToolRenderer({
    name,
    render: (ctx) => {
      const [expanded, setExpanded] = createSignal(false);
      return (
        <BaseTool
          type="call"
          icon={Stack}
          renderContext={ctx.renderContext}
          response={
            ctx.response && expanded() ? (
              <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all text-ink-muted">
                {JSON.stringify(ctx.response.data, null, 2)}
              </pre>
            ) : undefined
          }
        >
          <div class="flex min-w-0 items-center justify-between gap-3">
            <span class="truncate">{label}</span>
            <Tool.ResultToggle
              expanded={expanded()}
              showToggle={!!ctx.response}
              onToggle={() => setExpanded((value) => !value)}
            />
          </div>
        </BaseTool>
      );
    },
  });
}

export const initiativeToolHandlers = {
  ListInitiatives: initiativeHandler('ListInitiatives', 'Find projects'),
  ReadInitiative: initiativeHandler('ReadInitiative', 'Read project'),
  CreateInitiative: initiativeHandler('CreateInitiative', 'Create project'),
  UpdateInitiative: initiativeHandler('UpdateInitiative', 'Update project'),
  DeleteInitiative: initiativeHandler('DeleteInitiative', 'Delete project'),
  UpdateInitiativeSharing: initiativeHandler(
    'UpdateInitiativeSharing',
    'Update project sharing'
  ),
  SetTaskInitiative: initiativeHandler('SetTaskInitiative', 'Set task project'),
  ReadTaskInitiatives: initiativeHandler(
    'ReadTaskInitiatives',
    'Read task projects'
  ),
  ReadInitiativeActivity: initiativeHandler(
    'ReadInitiativeActivity',
    'Read project activity'
  ),
  ReadInitiativeDiscussions: initiativeHandler(
    'ReadInitiativeDiscussions',
    'Read project discussions'
  ),
  PostInitiativeComment: initiativeHandler(
    'PostInitiativeComment',
    'Post project comment'
  ),
  UpdateInitiativeComment: initiativeHandler(
    'UpdateInitiativeComment',
    'Update project comment'
  ),
  DeleteInitiativeComment: initiativeHandler(
    'DeleteInitiativeComment',
    'Delete project comment'
  ),
  ReactToInitiativeComment: initiativeHandler(
    'ReactToInitiativeComment',
    'React to project comment'
  ),
  SetInitiativeDiscussionResolved: initiativeHandler(
    'SetInitiativeDiscussionResolved',
    'Update discussion status'
  ),
};
