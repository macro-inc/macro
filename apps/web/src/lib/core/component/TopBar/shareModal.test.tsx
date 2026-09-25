import { render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import { useShareModal } from './shareModal';

vi.mock('./ShareButton', () => ({
  ShareModal: (props: { name: string }) => (
    <div data-testid="share-modal">{props.name}</div>
  ),
}));
vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelQuery: vi.fn(),
  useDocumentMetadataQuery: vi.fn(),
}));

describe('useShareModal', () => {
  it('waits for share data before opening', async () => {
    const [ready, setReady] = createSignal(false);
    let openShare!: () => void;
    render(() => {
      openShare = useShareModal(() =>
        ready()
          ? {
              id: 'doc-1',
              blockAlias: 'md',
              itemType: 'document',
              name: 'Plan',
              userPermissions: Permissions.OWNER,
            }
          : undefined
      );
      return <ImperativeDialogHost />;
    });

    openShare();
    expect(screen.queryByTestId('share-modal')).toBeNull();

    setReady(true);
    expect((await screen.findByTestId('share-modal')).textContent).toBe('Plan');
  });
});
