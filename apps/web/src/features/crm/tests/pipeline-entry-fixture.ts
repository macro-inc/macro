import type { DataType } from '@service-storage/generated/schemas/dataType';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import type { PipelineEntry, PipelineEntryCell } from '../core/pipeline-entry';

/** The made-up owner a fixture's Owner field names. */
export const FIXTURE_OWNER = {
  id: 'user-owner',
  name: 'Priyanka Ramaswamy-Okafor',
};

const DRAFT = [
  'Hi Marisol,',
  'Saw you have been in Macro most days this week. Is there anything we could make easier for your team?',
  'Happy to set up a short call if that helps.',
  'Alex',
].join('\n\n');

const AUTO_DRAFT = [
  'Hi Marisol,',
  'Thanks for trying Macro. Teams on the free plan usually start by inviting one or two people to a shared channel.',
  'Reply here if you want a hand with that.',
].join('\n\n');

function cell(
  name: string,
  dataType: DataType,
  value: DatabaseCellValue,
  extra: Partial<DatabaseViewColumn> = {}
): PipelineEntryCell {
  return {
    column: {
      id: name.toLowerCase().replaceAll(/[^a-z]+/g, '-'),
      name,
      dataType,
      isMultiSelect: false,
      options: [],
      writable: true,
      ...extra,
    },
    value,
  };
}

function select(name: string, value: string, color: string) {
  return cell(name, 'SELECT_STRING', value, {
    options: [{ id: `${name}-${value}`, label: value, color }],
  });
}

/**
 * A contact's row in a trial pipeline: 21 fields of the types, order and
 * lengths a real one has, with made-up people. Four are empty.
 */
export function contactPipelineEntry(
  overrides: Partial<PipelineEntry['pipeline']> = {}
): PipelineEntry {
  return {
    rowId: 'trial-row',
    pipeline: {
      id: 'trial-outreach',
      name: 'Trial outreach',
      tableId: 'trial-outreach-table',
      shared: true,
      canEdit: true,
      ...overrides,
    },
    cells: [
      select('Status', 'Skipped', '#6e6ade'),
      cell("Today's list", 'BOOLEAN', 0),
      cell('Pinned', 'BOOLEAN', null),
      select('Play', 'Free · power user', '#edb200'),
      cell(
        'Why',
        'STRING',
        'Most active 5/14 days · 2 emails sent from Macro · last seen Nov 4'
      ),
      cell('Score', 'NUMBER', 12),
      cell('History', 'STRING', 'Skipped: using Macro, 5 of the last 14 days'),
      cell('Draft subject', 'STRING', 'How’s Macro going?'),
      cell('Draft', 'STRING', DRAFT),
      cell('First name', 'STRING', 'Marisol'),
      cell('Primary email', 'STRING', 'marisol@harborline.example.com'),
      cell('People', 'STRING', 'marisol'),
      select('Plan', 'Free', '#a35cf0'),
      cell('Trial ends', 'DATE', null),
      cell('Contact on', 'DATE', '2026-11-06'),
      cell('Notes', 'STRING', null),
      cell('LinkedIn', 'LINK', null),
      cell('Last outreach', 'DATE', null),
      select('Stage', 'Lead', '#3080ff'),
      cell('Owner', 'ENTITY', FIXTURE_OWNER.id, { specificEntityType: 'USER' }),
      cell('Auto draft', 'STRING', AUTO_DRAFT),
    ],
  };
}
