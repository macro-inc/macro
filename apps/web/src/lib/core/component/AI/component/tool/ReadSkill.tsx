import BookOpen from '@phosphor-icons/core/regular/book-open.svg';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

export const readSkillHandler = createToolRenderer({
  name: 'ReadSkill',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const result = () => ctx.response?.data;

    return (
      <BaseTool
        icon={BookOpen}
        renderContext={ctx.renderContext}
        type="call"
        response={
          result() && isExpanded() ? (
            <pre class="max-h-120 overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm">
              {result()?.content}
            </pre>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 break-words">
            Read skill{result() ? `: ${result()?.name}` : ''}
          </span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={!!result()}
            status={result() ? 'Read' : undefined}
          />
        </div>
      </BaseTool>
    );
  },
});
