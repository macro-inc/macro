import type { EntityData, WithNotification } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactListSource } from '../context/artifact-source';
import { ArtifactsListView } from './artifacts-list-view';

// The shared row needs the app's user and tag contexts; it stays a plain
// button here so the test drives the list's own behavior.
vi.mock('@entity', () => ({
  ListEntity: (props: {
    entity: { name: string };
    onClick?: (event: MouseEvent) => void;
  }) => (
    <button type="button" onClick={(event) => props.onClick?.(event)}>
      {props.entity.name}
    </button>
  ),
  ListEntityMetadataQueryProvider: (props: { children: JSX.Element }) =>
    props.children,
  ListLayoutProvider: (props: { children: JSX.Element }) => props.children,
}));

afterEach(cleanup);

function documentEntity(
  id: string,
  name: string,
  fileType: string
): WithNotification<EntityData> {
  return {
    type: 'document',
    id,
    name,
    fileType,
    ownerId: 'owner',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  };
}

function fakeSource(
  documents: () => WithNotification<EntityData>[],
  overrides: Partial<ArtifactListSource> = {}
): ArtifactListSource {
  return {
    documents,
    loading: () => false,
    failed: () => false,
    hasMore: () => false,
    loadingMore: () => false,
    loadMoreFailed: () => false,
    loadMore: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('Artifacts list', () => {
  it('lists only HTML documents and opens the one clicked', async () => {
    const launch = documentEntity('launch', 'Launch dashboard', 'html');
    const source = fakeSource(() => [
      launch,
      documentEntity('notes', 'Meeting notes', 'md'),
      documentEntity('report', 'Weekly report', 'HTM'),
      documentEntity('sheet', 'Budget', 'spreadsheet'),
      { type: 'chat', id: 'chat', name: 'Plan launch', ownerId: 'me' },
    ]);
    const open = vi.fn();
    render(() => <ArtifactsListView source={source} onOpen={open} />);

    const list = await screen.findByRole('list', { name: 'Artifacts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Launch dashboard');
    expect(rows[1].textContent).toContain('Weekly report');
    expect(screen.queryByText('Meeting notes')).toBeNull();
    expect(screen.queryByText('Budget')).toBeNull();

    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Launch dashboard' })
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'launch' }),
      expect.anything()
    );
  });

  it('explains where artifacts come from when there are none', () => {
    const [documents, setDocuments] = createSignal<
      WithNotification<EntityData>[]
    >([documentEntity('notes', 'Meeting notes', 'md')]);
    const [loading, setLoading] = createSignal(true);
    render(() => (
      <ArtifactsListView
        source={fakeSource(documents, { loading })}
        onOpen={vi.fn()}
      />
    ));
    expect(
      screen.getByRole('status', { name: 'Loading artifacts' })
    ).toBeTruthy();

    setLoading(false);
    expect(screen.getByText('No artifacts yet')).toBeTruthy();
    expect(
      screen.getByText(/Pages that agents publish appear here/)
    ).toBeTruthy();

    setDocuments([documentEntity('page', 'Status page', 'html')]);
    expect(screen.getByText('Status page')).toBeTruthy();
    expect(screen.queryByText('No artifacts yet')).toBeNull();
  });

  it('retries a list that failed to load', () => {
    const source = fakeSource(() => [], { failed: () => true });
    render(() => <ArtifactsListView source={source} onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.retry).toHaveBeenCalledTimes(1);
  });
});
