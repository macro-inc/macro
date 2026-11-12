import { compileFacets } from '@app/features/soup/filters/facets';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { describe, expect, it } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import {
  EMPTY_TASK_FACET_CONTEXT,
  getTaskFacetOption,
  TASK_FACETS,
} from './task-facets';
import { taskMatchesView } from './task-predicates';

const PROJECT_A = '10000000-0000-4000-8000-000000000001';
const PROJECT_B = '10000000-0000-4000-8000-000000000002';

const TASK = boardEntity('task', [
  boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
    type: 'EntityReference',
    value: [{ entity_id: PROJECT_A, entity_type: 'INITIATIVE' }],
  }),
  boardProperty(
    SYSTEM_PROPERTY_IDS.STATUS,
    {
      type: 'SelectOption',
      value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
    },
    'SELECT_STRING'
  ),
]);

describe('Project task facet', () => {
  it('compiles multiple projects as alternative entity references', () => {
    expect(
      compileFacets(
        { project: [PROJECT_A, PROJECT_B] },
        TASK_FACETS,
        EMPTY_TASK_FACET_CONTEXT
      ).propf
    ).toEqual({
      '|': [
        { l: { pd: SYSTEM_PROPERTY_IDS.PROJECT, v: { er: PROJECT_A } } },
        { l: { pd: SYSTEM_PROPERTY_IDS.PROJECT, v: { er: PROJECT_B } } },
      ],
    });
    expect(
      getTaskFacetOption(
        'project',
        'not-a-project-id',
        EMPTY_TASK_FACET_CONTEXT
      )
    ).toBeUndefined();
  });

  it('ORs projects, ANDs other facets, and excludes tasks without project links', () => {
    const context = {
      tab: 'team-tasks' as const,
      userId: 'viewer',
      facets: { project: [PROJECT_B, PROJECT_A], status: ['in-progress'] },
    };
    expect(taskMatchesView(TASK, context)).toBe(true);
    expect(
      taskMatchesView(TASK, { ...context, facets: { project: [PROJECT_B] } })
    ).toBe(false);
    expect(
      taskMatchesView(TASK, {
        ...context,
        facets: { project: [PROJECT_A], status: ['completed'] },
      })
    ).toBe(false);
    expect(taskMatchesView(boardEntity('unlinked'), context)).toBe(false);
    expect(
      taskMatchesView(boardEntity('unlinked'), { ...context, facets: {} })
    ).toBe(true);
  });

  it('matches any project on a task and never treats a Drive folder as its project', () => {
    const task = boardEntity('multi-project', [
      boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
        type: 'EntityReference',
        value: [
          { entity_id: PROJECT_A, entity_type: 'INITIATIVE' },
          { entity_id: PROJECT_B, entity_type: 'INITIATIVE' },
        ],
      }),
    ]);
    expect(
      taskMatchesView(task, {
        tab: 'team-tasks',
        userId: 'viewer',
        facets: { project: [PROJECT_B] },
      })
    ).toBe(true);
    expect(
      taskMatchesView(
        { ...boardEntity('folder'), projectId: PROJECT_A },
        {
          tab: 'team-tasks',
          userId: 'viewer',
          facets: { project: [PROJECT_A] },
        }
      )
    ).toBe(false);
  });
});
