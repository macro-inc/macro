import { render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import { useShareModal } from './shareModal';

vi.mock('./ShareButton', () => ({
  ShareModal: (props: {
    name: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="share-modal"
      onClick={() => props.onOpenChange(false)}
    >
      {props.name}
    </button>
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

  it('reports when an opened modal closes', async () => {
    const onClose = vi.fn();
    let openShare!: () => void;
    render(() => {
      openShare = useShareModal(
        () => ({
          id: 'doc-1',
          blockAlias: 'md',
          itemType: 'document',
          name: 'Plan',
          userPermissions: Permissions.OWNER,
        }),
        { onClose }
      );
      return <ImperativeDialogHost />;
    });

    openShare();
    (await screen.findByTestId('share-modal')).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('share-modal')).toBeNull();
  });
});
