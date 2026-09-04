import BookOpen from '@phosphor-icons/core/regular/book-open.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

/**
 * `DescribeSoup` fetches a slice of the QuerySoup schema for the model. The
 * SDL it returns is reference material the model reads, not a result the user
 * needs to inspect, so the row names the topics and hides the payload.
 */
const handler = createToolRenderer({
  name: 'DescribeSoup',
  render: (ctx) => {
    const topics = () => {
      const requested = ctx.tool.data.topics ?? [];
      return requested.map((topic) => topic.toLowerCase().replace(/_/g, ' '));
    };
    return (
      <BaseTool icon={BookOpen} renderContext={ctx.renderContext} type="call">
        <span class="min-w-0 truncate">
          Read workspace schema{' '}
          <span class="text-ink">{topics().join(', ')}</span>
        </span>
      </BaseTool>
    );
  },
});

export const describeSoupHandler = handler;
