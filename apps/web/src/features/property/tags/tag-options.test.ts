import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { describe, expect, it } from 'vitest';
import { listTagOptions } from './tag-options';

const option = (
  id: string,
  label: string,
  propertyDefinitionId: string,
  displayOrder: number,
  color?: string
) => ({
  id,
  propertyDefinitionId,
  displayOrder,
  color,
  value: { type: 'string' as const, value: label },
});

describe('listTagOptions', () => {
  it('lists personal tags before team tags, each in display order', () => {
    const tagSets = [
      {
        scope: 'team',
        definition: { id: 'team-definition' },
        options: [option('launch', 'Launch', 'team-definition', 0, '#123')],
      },
      {
        scope: 'user',
        definition: { id: 'personal-definition' },
        options: [
          option('later', 'Later', 'personal-definition', 1),
          option('urgent', 'Urgent', 'personal-definition', 0),
        ],
      },
    ] as TagSetResponse[];

    expect(listTagOptions(tagSets)).toEqual([
      {
        id: 'urgent',
        label: 'Urgent',
        color: undefined,
        scope: 'user',
        propertyDefinitionId: 'personal-definition',
      },
      {
        id: 'later',
        label: 'Later',
        color: undefined,
        scope: 'user',
        propertyDefinitionId: 'personal-definition',
      },
      {
        id: 'launch',
        label: 'Launch',
        color: '#123',
        scope: 'team',
        propertyDefinitionId: 'team-definition',
      },
    ]);
  });

  it('skips a set that has not been provisioned yet', () => {
    const tagSets = [{ scope: 'user', options: [] }] as TagSetResponse[];

    expect(listTagOptions(tagSets)).toEqual([]);
  });
});
