import Tag from '@phosphor-icons/core/regular/tag.svg';
import { TagDot } from '@property/tags/TagDot';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ListTagsSet = NamedTool<'ListTags', 'response'>['data']['tagSets'][number];

const ListTagsToolResponse = (props: { tagSets: ListTagsSet[] }) => (
  <Tool.List>
    <For each={props.tagSets}>
      {(set) => (
        <For each={set.tags}>
          {(tag) => (
            <Tool.ListItem icon={<TagDot color={tag.color ?? undefined} />}>
              <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span class="truncate text-xs text-ink">{tag.label}</span>
                <span class="shrink-0 text-xxs text-ink-muted">
                  {set.scope}
                </span>
              </div>
            </Tool.ListItem>
          )}
        </For>
      )}
    </For>
  </Tool.List>
);

const handler = createToolRenderer({
  name: 'ListTags',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const tagSets = () => ctx.response?.data.tagSets ?? [];
    const tagCount = () =>
      tagSets().reduce((count, set) => count + set.tags.length, 0);
    const hasResults = () => tagCount() > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (tagCount() === 0) return 'No Tags';
      if (tagCount() === 1) return '1 tag';
      return `${tagCount()} tags`;
    };

    return (
      <BaseTool
        icon={Tag}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListTagsToolResponse tagSets={tagSets()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">List available tags</span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const listTagsHandler = handler;
