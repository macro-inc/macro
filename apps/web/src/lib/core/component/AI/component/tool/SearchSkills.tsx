import { getEntityClickContent } from '@channel/Attachments/attachment-utils';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { buildEntityData, EntityRowIcon, EntityRowTitle } from '@entity';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type SkillSearchResult = NamedTool<
  'SearchSkills',
  'response'
>['data']['results'][number];

function SkillResultRow(props: { result: SkillSearchResult }) {
  const { insertSplit } = useSplitLayout();

  const entity = () =>
    buildEntityData({
      id: props.result.documentId,
      name: props.result.name,
      blockName: 'skill',
    });

  const openSkill = () => {
    const skill = entity();
    if (!skill) return;
    insertSplit(getEntityClickContent(skill));
  };

  return (
    <Show when={entity()}>
      {(skill) => (
        <button
          type="button"
          class="block w-full text-left hover:bg-surface-hover"
          onClick={openSkill}
        >
          <Tool.ListItem icon={<EntityRowIcon entity={skill()} />}>
            <div class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 truncate text-ink">
                <EntityRowTitle entity={skill()} />
              </span>
            </div>
          </Tool.ListItem>
        </button>
      )}
    </Show>
  );
}

export const searchSkillsHandler = createToolRenderer({
  name: 'SearchSkills',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const results = () => ctx.response?.data.results ?? [];
    const hitCount = () => results().length;
    const hasResults = () => hitCount() > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (hitCount() === 0) return 'No Results';
      if (hitCount() === 1) return '1 skill';
      return `${hitCount()} skills`;
    };

    return (
      <BaseTool
        icon={MagnifyingGlass}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <div class="max-h-120 overflow-y-auto">
              <Tool.List>
                <For each={results()}>
                  {(result) => <SkillResultRow result={result} />}
                </For>
              </Tool.List>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span class="min-w-0 truncate">
              Search skills <span class="text-ink"> {ctx.tool.data.name} </span>
            </span>
          </div>
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
