import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { InlineEntity } from '@entity';
import { For, Match, Switch } from 'solid-js';
import { useQuickAccess } from '../QuickAccessProvider';

export default function QuickAccessAll() {
  const { useList } = useQuickAccess();

  // @example const entities = useList('task', 'note', 'document', 'project');
  const entities = useList();

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Quick Access - List"></StaticSplitLabel>
      </SplitHeaderLeft>
      <div class="size-full p-4 overflow-scroll scrollbar-hidden">
        <For each={entities()}>
          {(item, ndx) => (
            <div class="flex items-center gap-2 py-2 truncate text-xs">
              <span class="font-mono text-ink-extra-muted text-xs opacity-50">
                {(ndx() + 1).toString().padStart(4, '0')}
              </span>
              <Switch>
                <Match when={item.kind === 'entity' && item}>
                  {(item) => <InlineEntity entity={item().data as any} />}
                </Match>
                <Match when={item.kind === 'user' && item}>
                  {(item) => (
                    <span>
                      {item().data.name} ({item().data.email})
                    </span>
                  )}
                </Match>
                <Match when={item}>
                  {(item) => (
                    <span>
                      {item().bucket} - ({item().searchText})
                    </span>
                  )}
                </Match>
              </Switch>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
