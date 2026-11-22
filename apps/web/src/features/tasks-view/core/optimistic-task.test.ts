import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyApiValues } from '@property/types';
import { expect, it } from 'vitest';
import { buildOptimisticTask } from './optimistic-task';

const status = (values: PropertyApiValues) =>
  buildOptimisticTask({
    id: 'temp',
    title: 'Ship it',
    ownerId: 'viewer',
    properties: [[SYSTEM_PROPERTY_IDS.STATUS, values]],
    definitions: new Map(),
    now: new Date('2026-11-22T12:00:00Z'),
  }).properties?.flatMap((property) =>
    property.definition.id === SYSTEM_PROPERTY_IDS.STATUS
      ? [property.value]
      : []
  );

it('shows the status the server will give a task', () => {
  const inProgress = PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS;
  expect(status({ valueType: 'SELECT_STRING', values: [inProgress] })).toEqual([
    { type: 'SelectOption', value: [inProgress] },
  ]);
  // A cleared Status is not sent, so the server sets Not started.
  expect(status({ valueType: 'SELECT_STRING', values: [] })).toEqual([
    {
      type: 'SelectOption',
      value: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
    },
  ]);
});
