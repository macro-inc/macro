import { match } from 'ts-pattern';
import type { EmailTab } from '../../../src/features/email-view/constants';
import { type FixtureRow, LINKS } from './filter-corpus';
import { USER_ID } from './mail';

export const ALL_INBOXES = '__all_inboxes__';

export const intersects = (selected: string[], values: readonly string[]) =>
  selected.length === 0 || selected.some((value) => values.includes(value));

/** Fixture truth only: no production AST compiler, cache reads or projections. */
export function emailMatchesSelection(
  row: FixtureRow,
  tab: EmailTab,
  selection: Record<string, string[]>
): boolean {
  if (tab === 'scheduled' || tab === 'reminders') {
    throw new Error(`${tab} membership is not owned by the Soup query`);
  }
  if (row.kind !== 'email') return false;
  if (
    tab === 'shared'
      ? !row.shared || row.owner === USER_ID
      : !LINKS.includes(row.linkId!)
  )
    return false;
  const matchesTab = match(tab)
    .with('important', () => row.signal === true && row.inbox === true)
    .with('noise', () => row.signal === false && row.inbox === true)
    .with('favorites', () => row.favorite === true)
    .with('archived', () => row.inbox === false)
    .with('drafts', () => row.draft === true)
    .with('sent', () => row.sent === true)
    .with('calendar', () => row.calendar === true)
    .with('shared', 'all', () => true)
    .exhaustive();
  if (!matchesTab) return false;
  if (
    (selection.inboxes[0] !== ALL_INBOXES &&
      !selection.inboxes.includes(row.linkId!)) ||
    !intersects(selection.tags, row.tags)
  )
    return false;
  if (
    (selection.read[0] === 'read' && !row.read) ||
    (selection.read[0] === 'unread' && row.read)
  )
    return false;
  if (
    (selection.done[0] === 'done' && row.inbox) ||
    (selection.done[0] === 'not-done' && !row.inbox)
  )
    return false;
  return selection.calendar.length === 0 || row.calendar === true;
}
