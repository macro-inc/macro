import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost, type ManagedDialogProps } from '@ui';
import { Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { openProjectEntityAction } from './project-entity-actions';
import type { ProjectEntityAction } from './views/project-entity-action';

vi.mock('./views/project-entity-action', () => ({
  ProjectEntityActionDialog: (
    props: ManagedDialogProps & { action: ProjectEntityAction }
  ) => (
    <Show when={props.open}>
      <button type="button" onClick={() => props.onOpenChange(false)}>
        {props.action.kind}
      </button>
    </Show>
  ),
}));

afterEach(cleanup);

it('opens the action in the app dialog host and closes it', async () => {
  render(() => <ImperativeDialogHost />);

  const handle = openProjectEntityAction({ kind: 'share', id: 'launch' });
  fireEvent.click(await screen.findByRole('button', { name: 'share' }));

  expect(await handle.closed).toMatchObject({ reason: 'dismissed' });
  expect(screen.queryByRole('button', { name: 'share' })).toBeNull();
});
