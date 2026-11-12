import type { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openBulkEditModal: vi.fn<typeof openBulkEditModal>(),
  openGlobalShareModal: vi.fn(),
  restoreFocus: vi.fn(),
}));

vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: mocks.openBulkEditModal,
}));
vi.mock('@app/features/sharing/global-share-modal/GlobalShareModal', () => ({
  openGlobalShareModal: mocks.openGlobalShareModal,
}));
vi.mock('../utils', () => ({
  restoreSoupFocus: mocks.restoreFocus,
}));

import type { EntityActionListState } from './entity-action-context';
import { makeShareAction } from './make-share-action';

const row = (type: EntityData['type'], id: string) =>
  ({ type, id, name: id, ownerId: 'macro|me@macro.com' }) as EntityData;

const spec = row('document', 'spec');
const notes = row('chat', 'notes');
const general = row('channel', 'general');

function listState(focusedId: string) {
  const focusSet = vi.fn();
  const clear = vi.fn();
  const soup: EntityActionListState = {
    focus: { id: () => focusedId, index: () => 0, set: focusSet },
    navigate: { peekOffset: () => undefined },
    items: { count: () => 0, get: () => undefined, at: () => undefined },
    selection: { clear },
    collapseEntity: { shouldCollapse: () => false, callback: () => undefined },
  };
  return { soup, focusSet, clear };
}

const bulkDialog = () => mocks.openBulkEditModal.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('makeShareAction', () => {
  it('opens ShareModal for one row and leaves the list as it is', async () => {
    const { soup, focusSet, clear } = listState('spec');

    await makeShareAction().executeWithSoup([spec], soup);

    expect(mocks.openGlobalShareModal).toHaveBeenCalledWith({ entity: spec });
    expect(mocks.openBulkEditModal).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(focusSet).not.toHaveBeenCalled();
    expect(mocks.restoreFocus).not.toHaveBeenCalled();
  });

  it('opens the bulk share dialog for two or more rows', async () => {
    await makeShareAction().execute([spec, notes]);

    expect(mocks.openBulkEditModal).toHaveBeenCalledWith({
      view: 'share',
      entities: [spec, notes],
    });
    expect(mocks.openGlobalShareModal).not.toHaveBeenCalled();
  });

  it('never passes a row with no list share flow to a share dialog', async () => {
    const action = makeShareAction();

    await action.execute([general]);
    expect(mocks.openGlobalShareModal).not.toHaveBeenCalled();

    await action.execute([general, spec]);
    expect(mocks.openGlobalShareModal).toHaveBeenCalledWith({ entity: spec });
    expect(mocks.openBulkEditModal).not.toHaveBeenCalled();
  });

  it('clears the selection on finish and returns focus to the row the user was on', async () => {
    const { soup, focusSet, clear } = listState('elsewhere');

    await makeShareAction().executeWithSoup([spec, notes], soup);
    bulkDialog().onFinish?.();

    expect(clear).toHaveBeenCalledOnce();
    expect(focusSet).toHaveBeenCalledWith('elsewhere');
    expect(mocks.restoreFocus).toHaveBeenCalledWith('elsewhere');
  });

  it('keeps the selection on cancel and focuses the first shared row', async () => {
    const { soup, focusSet, clear } = listState('elsewhere');

    await makeShareAction().executeWithSoup([spec, notes], soup);
    bulkDialog().onCancel?.();

    expect(clear).not.toHaveBeenCalled();
    expect(focusSet).toHaveBeenCalledWith('spec');
    expect(mocks.restoreFocus).toHaveBeenCalledWith('spec');
  });
});
