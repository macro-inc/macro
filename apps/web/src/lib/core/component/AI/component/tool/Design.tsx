import { ItemPreview } from '@core/component/ItemPreview';
import PenNibIcon from '@phosphor-icons/core/regular/pen-nib.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/** Page count from the first line of a ReadDesign description. */
export function describedPageCount(content: string): number | undefined {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const match = /^Design: .* \((\d+) pages?\)$/.exec(firstLine);
  return match ? Number(match[1]) : undefined;
}

export const readDesignHandler = createToolRenderer({
  name: 'ReadDesign',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const content = () => ctx.response?.data.content;
    const summary = () => {
      const text = content();
      if (text === undefined) return undefined;
      const count = describedPageCount(text);
      if (count === undefined) return 'Read';
      return `${count} page${count === 1 ? '' : 's'}`;
    };
    return (
      <BaseTool
        icon={PenNibIcon}
        type="call"
        renderContext={ctx.renderContext}
        response={
          <Show when={expanded() && content()}>
            {(details) => (
              <pre class="max-h-80 overflow-auto whitespace-pre-wrap pb-1 font-mono text-ink text-xs">
                {details()}
              </pre>
            )}
          </Show>
        }
      >
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            Read <span class="text-ink">design</span>{' '}
            <span class="text-ink-placeholder">·</span>{' '}
            <Suspense>
              <ItemPreview
                class="inline-flex align-middle ring-0"
                id={ctx.tool.data.documentId}
                type="document"
              />
            </Suspense>
          </div>
          <Show when={summary()}>
            {(status) => (
              <Tool.ResultToggle
                expanded={expanded()}
                showToggle={!!content()}
                onToggle={() => setExpanded((value) => !value)}
                status={<span>{status()}</span>}
              />
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});
