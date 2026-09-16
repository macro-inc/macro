import { runCreateAction } from '@app/features/command/Launcher';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useSplitLayout } from '@components/app/split-layout/layout';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import PlusIcon from '@phosphor/plus.svg';
import SkillIcon from '@phosphor/sparkle.svg';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export function AgentResourceList(props: { page: 'routines' | 'skills' }) {
  const layout = useSplitLayout();
  const automations = useAutomationEntities();
  const skillsQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(defineQueryFilters({ include: { subType: ['skill'] } }))
      ),
    }),
    () => ({ enabled: props.page === 'skills' })
  );
  const items = () =>
    props.page === 'routines'
      ? automations()
      : skillsQuery.isLoading
        ? []
        : (skillsQuery.data?.entities ?? []);
  const loading = () => props.page === 'skills' && skillsQuery.isLoading;
  const error = () => props.page === 'skills' && Boolean(skillsQuery.error);

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex h-12 shrink-0 items-center px-4">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 gap-2 rounded-lg bg-ink/4 px-3"
          onClick={() =>
            runCreateAction(props.page === 'routines' ? 'automation' : 'skill')
          }
        >
          <PlusIcon class="size-3.5" />
          {props.page === 'routines' ? 'New routine' : 'New skill'}
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <For each={items()}>
          {(item) => (
            <Button
              variant="ghost"
              class="h-12 w-full justify-start gap-3 rounded-xl px-3 font-normal"
              onClick={(event) =>
                layout.openWithSplit(
                  {
                    type: props.page === 'routines' ? 'automation' : 'skill',
                    id: item.id,
                  },
                  { preferNewSplit: event.shiftKey }
                )
              }
            >
              <Dynamic
                component={props.page === 'routines' ? ClockIcon : SkillIcon}
                class="size-4 text-ink-muted"
              />
              <span class="truncate">{item.name}</span>
            </Button>
          )}
        </For>
        <Show when={items().length === 0 && !error()}>
          <p class="px-3 py-6 text-sm text-ink-muted">
            {loading() ? 'Loading skills…' : `No ${props.page} yet`}
          </p>
        </Show>
        <Show when={error()}>
          <Button variant="ghost" onClick={() => void skillsQuery.refetch()}>
            Retry loading skills
          </Button>
        </Show>
        <Show when={props.page === 'skills' && skillsQuery.hasNextPage}>
          <Button
            variant="ghost"
            disabled={skillsQuery.isFetchingNextPage}
            onClick={() => void skillsQuery.fetchNextPage()}
          >
            {skillsQuery.isFetchingNextPage ? 'Loading…' : 'More skills'}
          </Button>
        </Show>
      </div>
    </div>
  );
}
