import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseCard } from './DatabaseCard';

const mocks = vi.hoisted(() => ({ enabled: false, mounted: 0 }));
vi.mock('@core/constant/featureFlags', () => ({ enableDatabases: {} }));
vi.mock('../../context/LexicalWrapperContext', async () => {
  const { createContext } = await import('solid-js');
  return { LexicalWrapperContext: createContext() };
});
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled }),
}));
vi.mock('@app/features/block-database/document-database', () => ({
  DocumentDatabase: (props: { collapsed?: boolean; onToggle: () => void }) => {
    mocks.mounted++;
    return (
      <div>
        {!props.collapsed && <div>Database records</div>}
        <button onClick={props.onToggle}>
          {props.collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  mocks.enabled = false;
  mocks.mounted = 0;
});

const card = () => (
  <DatabaseCard
    key="database-card"
    documentId="db-1"
    documentName="Tasks"
    blockName="database"
    theme={{}}
  />
);

it('keeps saved database cards inert when the feature is disabled', () => {
  render(card);
  expect(screen.getByText('Tasks')).toBeTruthy();
  expect(mocks.mounted).toBe(0);
});

it('allows a static document viewer to collapse and expand locally', async () => {
  mocks.enabled = true;
  render(card);
  await screen.findByText('Database records');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
  expect(screen.queryByText('Database records')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
  expect(screen.getByText('Database records')).toBeTruthy();
});
