/** @vitest-environment jsdom */
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { ManagementPreview } from './management-preview';
import type { ManagementKind } from './management-preview-data';

afterEach(cleanup);

function preview(kind: ManagementKind, query = '') {
  const history = createMemoryHistory();
  history.set({ value: `/${query}` });
  return {
    history,
    ...render(() => (
      <MemoryRouter history={history}>
        <Route path="/" component={() => <ManagementPreview kind={kind} />} />
      </MemoryRouter>
    )),
  };
}

it('retains a new routine draft through nested trigger pages and saves it to the list', async () => {
  const view = preview('routines', '?agentItem=new');
  await fireEvent.input(view.getByRole('textbox', { name: 'Routine name' }), {
    target: { value: 'Design review' },
  });
  await fireEvent.input(
    view.getByRole('textbox', { name: 'Agent instructions' }),
    {
      target: { value: 'Review the latest designs.' },
    }
  );
  await fireEvent.click(view.getByRole('button', { name: /Every weekday At/ }));
  await waitFor(() =>
    expect(view.history.get()).toContain('agentSection=trigger')
  );
  await fireEvent.click(view.getByRole('button', { name: 'Every Monday' }));
  await fireEvent.click(view.getByRole('button', { name: 'Done' }));
  await waitFor(() =>
    expect(view.getByDisplayValue('Review the latest designs.')).toBeTruthy()
  );
  expect(view.getByRole('button', { name: /Every Monday At/ })).toBeTruthy();
  await fireEvent.click(view.getByRole('button', { name: 'Save routine' }));
  await waitFor(() =>
    expect(view.getByRole('status').textContent).toContain('Saved')
  );
  await fireEvent.click(view.getByRole('tab', { name: 'Run history' }));
  await waitFor(() => expect(view.getByText('No runs yet')).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: 'All routines' }));
  await waitFor(() =>
    expect(
      view.getByRole('button', { name: /Design review Every Monday Paused/ })
    ).toBeTruthy()
  );
});

it('keeps agent tool selections when returning from a nested page using history', async () => {
  const view = preview('agents', '?agentItem=personal-assistant');
  await fireEvent.click(view.getByRole('button', { name: 'Add tools' }));
  await waitFor(() =>
    expect(view.getByRole('checkbox', { name: 'Web search' })).toBeTruthy()
  );
  await fireEvent.click(view.getByRole('checkbox', { name: 'Web search' }));
  view.history.back();
  await waitFor(() =>
    expect(
      view.getByRole('button', { name: 'Web search Included' })
    ).toBeTruthy()
  );
  await fireEvent.click(view.getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(view.getByRole('status')).toBeTruthy());
  await fireEvent.input(view.getByRole('textbox', { name: 'Agent name' }), {
    target: { value: 'Personal helper' },
  });
  expect(view.queryByRole('status')).toBeNull();
  expect(view.queryByRole('dialog')).toBeNull();
});
