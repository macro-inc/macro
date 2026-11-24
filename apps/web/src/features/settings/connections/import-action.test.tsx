/** @vitest-environment jsdom */

import { IMPORT_CATEGORIES } from '@app/features/connector-import/core/catalog';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { connectorDescription, ImportAction } from './import-action';

type FlagState = { enabled: boolean; loading: boolean };
const flags = vi.hoisted(() => ({
  fusion: { enabled: true, loading: false } as FlagState,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-fusion-import'
      ? flags.fusion
      : { enabled: false, loading: false },
}));

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

afterEach(() => {
  cleanup();
  flags.fusion = { enabled: true, loading: false };
});

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

it('offers Autodesk Fusion while its flag is on', async () => {
  render(() => <ImportAction appSlug="autodesk" name="Autodesk" />);
  fireEvent.click(screen.getByRole('button', { name: 'Import from Autodesk' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import files' });
  expect(dialog.textContent).toBe('Autodesk Fusion');
});

it.each([
  ['off', { enabled: false, loading: false }],
  ['loading', { enabled: false, loading: true }],
])('hides Autodesk Fusion while its flag is %s', (_, state) => {
  flags.fusion = state;
  render(() => <ImportAction appSlug="autodesk" name="Autodesk" />);
  expect(
    screen.queryByRole('button', { name: 'Import from Autodesk' })
  ).toBeNull();
});

it('describes an app by whether it can be imported from', () => {
  expect(connectorDescription(undefined, 'Autodesk')).toBe(
    'Agents can use Autodesk when you ask them to. Nothing is copied into Macro.'
  );
  const files = IMPORT_CATEGORIES.files;
  const source = (slug: string) => ({
    config: files,
    provider: files.providers.find((p) => p.appSlug === slug)!,
  });
  expect(connectorDescription(source('notion'), 'Notion')).toBe(
    'Import pages and wikis into your Drive, or connect so agents can use Notion without copying anything.'
  );
  expect(connectorDescription(source('autodesk'), 'Autodesk')).toBe(
    'Import CAD designs and their versions into your Drive, or connect so agents can use Autodesk without copying anything.'
  );
});
