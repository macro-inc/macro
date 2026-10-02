import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentTitleHoverCard } from './DocumentTitleHoverCard';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  query: { isSuccess: false, data: [] as Record<string, unknown>[] },
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element; content: JSX.Element }) => (
    <>
      {props.trigger}
      {props.content}
    </>
  ),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ getById: mocks.getById }),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: () => mocks.query,
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: () => 'Jordan',
}));
vi.mock('@core/util/date', () => ({ formatDate: (value: string) => value }));
beforeEach(() => {
  mocks.getById.mockReturnValue(undefined);
  mocks.query.isSuccess = false;
  mocks.query.data = [];
});
afterEach(cleanup);

it('shows owner and saved timestamps from the focused lookup', () => {
  mocks.query.isSuccess = true;
  mocks.query.data = [
    {
      id: 'doc',
      ownerId: 'owner',
      updatedAt: 'updated',
      createdAt: 'created',
      viewedAt: 'viewed',
    },
  ];
  render(() => (
    <DocumentTitleHoverCard documentId="doc" name="My task">
      <button>Title</button>
    </DocumentTitleHoverCard>
  ));
  expect(screen.getByText('Jordan')).toBeTruthy();
  expect(screen.getByText('updated')).toBeTruthy();
  expect(screen.getByText('created')).toBeTruthy();
  expect(screen.queryByText('viewed')).toBeNull();
  expect(screen.queryByText('Last viewed')).toBeNull();
  expect(screen.getByRole('button', { name: 'Title' })).toBeTruthy();
});

it('keeps known metadata visible while timestamps load', () => {
  mocks.getById.mockReturnValue({
    kind: 'entity',
    data: { ownerId: 'owner' },
    timestamps: { createdAt: 'cached creation' },
  });
  render(() => (
    <DocumentTitleHoverCard
      documentId="doc"
      name="Canvas"
      updatedAt="live update"
    />
  ));
  expect(screen.getByText('Jordan')).toBeTruthy();
  expect(screen.getByText('live update')).toBeTruthy();
  expect(screen.getByText('cached creation')).toBeTruthy();
});

it('does not invent dates or owners when records are missing', () => {
  render(() => <DocumentTitleHoverCard documentId="doc" name="Unknown" />);
  expect(screen.getAllByText('Not available')).toHaveLength(3);
});
