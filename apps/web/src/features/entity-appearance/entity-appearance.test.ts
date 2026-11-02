import { fireEvent, render, screen } from '@solidjs/testing-library';
import { openDialog } from '@ui/components/ImperativeDialog';
import { createComponent } from 'solid-js';
import { spread } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityAppearanceTrigger } from './entity-appearance';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'editor' }));
vi.mock('@ui/components/ImperativeDialog', () => ({ openDialog: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const DOCUMENT = {
  type: 'document' as const,
  id: 'document',
  ownerId: 'editor',
  name: 'Note',
  fileType: 'md',
};

describe('header icon editing', () => {
  it('opens the editor without triggering surrounding header navigation', () => {
    const navigate = vi.fn();
    const container = document.createElement('div');
    spread(container, { onClick: navigate });
    document.body.append(container);
    render(
      () =>
        createComponent(EntityAppearanceTrigger, {
          entity: DOCUMENT,
          editable: true,
        }),
      { container }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change icon…' }));
    expect(openDialog).toHaveBeenCalledOnce();
    expect(vi.mocked(openDialog).mock.calls[0][1]).toMatchObject({
      entity: DOCUMENT,
      userId: 'editor',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps read-only header icons non-editable', () => {
    render(() =>
      createComponent(EntityAppearanceTrigger, {
        entity: DOCUMENT,
        editable: false,
      })
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(openDialog).not.toHaveBeenCalled();
  });
});
