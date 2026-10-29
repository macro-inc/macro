import type { TaskEntityWithProperties } from '@entity/types/entity';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import type { MentionItem } from '../../../../utils/mentionsUtils';
import { MentionsMenuItem } from './MentionsMenuItem';

const time = '2026-10-01T00:00:00Z';

function taskItem(task: Partial<TaskEntityWithProperties>): MentionItem {
  return {
    kind: 'entity',
    bucket: 'task',
    id: 'task-1',
    searchText: 'Ship it',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      id: 'task-1',
      name: 'Ship it',
      ownerId: 'user-1',
      type: 'document',
      fileType: 'md',
      subType: { type: 'task' },
      ...task,
    } as TaskEntityWithProperties,
  };
}

function renderItem(item: MentionItem) {
  return render(() => (
    <MentionsMenuItem
      item={item}
      index={0}
      selected={false}
      itemAction={() => {}}
      setIndex={() => {}}
      setOpen={() => {}}
    />
  ));
}

describe('MentionsMenuItem task rows', () => {
  it('shows the task progress icon for its status', () => {
    const view = renderItem(
      taskItem({
        properties: [
          {
            id: 'status',
            definition: {
              id: SYSTEM_PROPERTY_IDS.STATUS,
              display_name: 'Status',
              data_type: 'SELECT_STRING',
              is_metadata: false,
              is_multi_select: false,
              is_system: true,
              owner: { scope: 'system' },
              specific_entity_type: 'TASK',
              created_at: time,
              updated_at: time,
            },
            value: {
              type: 'SelectOption',
              value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
            },
          },
        ],
      })
    );
    expect(view.getByRole('img', { name: 'Task: In progress' })).toBeTruthy();
    view.unmount();
  });

  it('falls back to the completion flag without a status', () => {
    const view = renderItem(
      taskItem({ subType: { type: 'task', is_completed: true } })
    );
    expect(view.getByRole('img', { name: 'Task: Completed' })).toBeTruthy();
    view.unmount();
  });
});
