import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { expect, it } from 'vitest';
import {
  filterProjectFixtureRows,
  rows,
} from '../browser-test/collection-data';

it('filters fixture projects by priority and inclusive date bounds', () => {
  expect(
    filterProjectFixtureRows(rows, {
      priority: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    }).map((row) => row.project.id)
  ).toEqual(['beta']);
  expect(
    filterProjectFixtureRows(rows, { dueAfter: '2026-01-11' }).map(
      (row) => row.project.id
    )
  ).toEqual(['beta']);
  expect(
    filterProjectFixtureRows(rows, { dueBefore: '2026-01-10' }).map(
      (row) => row.project.id
    )
  ).toEqual(['alpha']);
  expect(
    filterProjectFixtureRows(rows, {
      dueAfter: '2026-01-10',
      dueBefore: '2026-01-10',
    }).map((row) => row.project.id)
  ).toEqual(['alpha']);
  expect(
    filterProjectFixtureRows(rows, {
      priority: PROPERTY_OPTION_IDS.PRIORITY.LOW,
      dueAfter: '2026-01-11',
    })
  ).toEqual([]);
});
