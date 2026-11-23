import type { EntityItem, UserItem } from '@core/context/quickAccess/types';
import type { ChannelEntity } from '@entity/types/entity';
import { expect, it } from 'vitest';
import { mergeCommandPeople } from './contact-items';

it.each([true, false])(
  'prefers current-search DM metadata regardless of person-row order (%s)',
  (personFirst) => {
    const old: EntityItem<ChannelEntity> = {
      kind: 'entity',
      bucket: 'dm',
      id: 'dm',
      searchText: 'Old label',
      sortTimestamp: 1,
      timestamps: {},
      data: {
        id: 'dm',
        type: 'channel',
        name: 'Old label',
        ownerId: 'macro|viewer@example.com',
        channelType: 'direct_message',
        participantIds: [
          'macro|viewer@example.com',
          'macro|person@example.com',
        ],
      },
    };
    const fresh: EntityItem<ChannelEntity> = {
      ...old,
      searchText: 'Fresh label',
      sortTimestamp: 2,
      data: { ...old.data, name: 'Fresh label' },
    };
    const user: UserItem = {
      kind: 'user',
      bucket: 'person',
      id: 'macro|person@example.com',
      searchText: 'Person',
      sortTimestamp: 1,
      timestamps: {},
      data: {
        id: 'macro|person@example.com',
        name: 'Person',
        email: 'person@example.com',
      },
      commandTarget: old,
    };
    const result = mergeCommandPeople(
      personFirst ? [user, fresh] : [fresh, user],
      [old],
      'macro|viewer@example.com'
    );
    expect(result).toHaveLength(1);
    expect(result[0].data.name).toBe('Fresh label');
    expect(result[0].sortTimestamp).toBe(2);
    expect(result[0].searchText).toContain('Person');
    expect(
      mergeCommandPeople(
        [{ ...user, commandTarget: fresh }],
        [old],
        'macro|viewer@example.com'
      )[0].data.name
    ).toBe('Fresh label');
  }
);
