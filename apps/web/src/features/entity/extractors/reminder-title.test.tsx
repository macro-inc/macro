import type { ReminderEntity } from '@entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ReminderTitle } from './reminder-title';

const state = vi.hoisted(() => ({
  source: { loading: false, access: 'access', name: 'Actual email subject' },
}));
vi.mock('@queries/preview', () => ({
  useItemPreview: () => [() => state.source],
  isAccessiblePreviewItem: (item: typeof state.source) =>
    !item.loading && item.access === 'access',
}));
afterEach(cleanup);
const entity = {
  type: 'reminder',
  id: 'r',
  name: 'Remember this',
  description: 'Remember this',
  referencedEntity: { id: 'e', type: 'email' },
} as ReminderEntity;
it('leads with the current source title and keeps the personal note secondary', () => {
  state.source = {
    loading: false,
    access: 'access',
    name: 'Actual email subject',
  };
  render(() => <ReminderTitle entity={entity} showNote />);
  expect(screen.getByText('Actual email subject')).toBeTruthy();
  expect(screen.getByText('Remember this').className).toContain(
    'text-ink-muted'
  );
});
it('never presents a stale source title when access is lost', () => {
  state.source = { loading: false, access: 'no_access', name: 'Private title' };
  render(() => <ReminderTitle entity={entity} showNote />);
  expect(screen.getByText('Unavailable email')).toBeTruthy();
  expect(screen.queryByText('Private title')).toBeNull();
});
