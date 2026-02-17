import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useQuickAccess } from '../QuickAccessProvider';
import { For } from 'solid-js';
import { InlineEntity } from '@entity';
import type { QuickAccessItem } from '../types';

export default function QuickAccessAll() {
  const { useList } = useQuickAccess();
  // const entities = useList('task', 'note', 'document', 'project');
  const entities = useList('person');

  const renderItem = (item: QuickAccessItem) => {
    if (item.kind === 'entity') {
      const entity = { ...item.data, ownerId: '' };
      return <InlineEntity entity={entity as any} />;
    }
    if (item.kind === 'user') {
      return (
        <span>
          {item.data.name} ({item.data.email})
        </span>
      );
    }
    return (
      <span>
        {item.bucket} - {item.searchText}
      </span>
    );
  };

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
              {renderItem(item)}
            </div>
          )}
        </For>
      </div>
    </>
  );
}
