/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ImportAction } from './import-action';

// Stands in for the lazily loaded import dialog host.
vi.mock('@core/util/lazyNamed', () => ({
  lazyNamed:
    () =>
    (props: {
      open: boolean;
      config: { action: string; providers: { name: string }[] };
    }) => (
      <Show when={props.open}>
        <div role="dialog" aria-label={props.config.action}>
          {props.config.providers.map((provider) => provider.name).join(', ')}
        </div>
      </Show>
    ),
}));
vi.mock('@app/features/connector-import/connector-import-dialog', () => ({}));

afterEach(cleanup);

it('opens the importer for just the chosen app', async () => {
  render(() => <ImportAction appSlug="jira" name="Jira" />);
  fireEvent.click(screen.getByRole('button', { name: 'Import from Jira' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import tasks' });
  expect(dialog.textContent).toBe('Jira');
});

it('offers no import for apps Macro cannot import from', () => {
  render(() => <ImportAction appSlug="zoom" name="Zoom" />);
  expect(screen.queryByRole('button', { name: 'Import from Zoom' })).toBeNull();
});
