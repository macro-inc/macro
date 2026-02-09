import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { seedMockDisplayNames } from '@core/user';
import { For, createSignal } from 'solid-js';
import { ListEntity } from '../composed/ListEntity';
import {
  ALL_MOCK_ENTITIES,
  createEntityWithNotifications,
  MOCK_NOTIFICATIONS,
  MOCK_USERS,
} from '../../mocks/mockEntityData';
import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

// Seed mock display names so user names render correctly
seedMockDisplayNames([...MOCK_USERS]);

export default function DebugEntityView() {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number | null>(
    null
  );

  const entitiesWithNotifications: WithNotification<EntityData>[] =
    ALL_MOCK_ENTITIES.map((entity, ndx) => {
      if (ndx % 6 === 0) {
        return createEntityWithNotifications(entity, MOCK_NOTIFICATIONS);
      }
      return entity;
    });

  const handleEntityClick = (entity: EntityData, index: number) => {
    console.log('Entity clicked:', entity);
    setLastSelectedIndex(index);
  };

  const handleEntityChecked = (
    entity: EntityData,
    index: number,
    checked: boolean,
    shiftKey: boolean
  ) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (shiftKey && lastSelectedIndex() !== null) {
          const start = Math.min(lastSelectedIndex()!, index);
          const end = Math.max(lastSelectedIndex()!, index);
          for (let i = start; i <= end; i++) {
            next.add(entitiesWithNotifications[i].id);
          }
        } else {
          next.add(entity.id);
        }
      } else {
        next.delete(entity.id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  };

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Enity Component Demo (mock data)" />
        jk
      </SplitHeaderLeft>
      <div class="w-full h-full overflow-auto">
        <For each={entitiesWithNotifications}>
          {(entity, index) => (
            <ListEntity
              entity={entity}
              onClick={() => handleEntityClick(entity, index())}
              checked={selectedIds().has(entity.id)}
              onChecked={(checked, shiftKey) =>
                handleEntityChecked(entity, index(), checked, shiftKey)
              }
              showUnrollNotifications={true}
            />
          )}
        </For>
      </div>
    </>
  );
}
