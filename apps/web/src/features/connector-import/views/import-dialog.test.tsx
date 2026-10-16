import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorImportProvider } from '../context/connector-import-context';
import { IMPORT_CATEGORIES } from '../core/catalog';
import type { ImportCategory } from '../core/providers';
import {
  fakeConnectorImport,
  importEntity,
  importRunState,
} from '../tests/fake-context';
import { ConnectorImportDialog } from './import-dialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function setup(
  category: ImportCategory,
  options?: Parameters<typeof fakeConnectorImport>[0] & {
    alternative?: () => void;
  }
) {
  const fake = fakeConnectorImport(options);
  const [open, setOpen] = createSignal(true);
  const onImported = vi.fn();
  render(() => (
    <ConnectorImportProvider context={fake.context}>
      <ConnectorImportDialog
        config={IMPORT_CATEGORIES[category]}
        open={open()}
        onOpenChange={setOpen}
        onImported={onImported}
        alternatives={
          options?.alternative && [
            {
              icon: () => <svg />,
              label: 'Upload a CSV',
              description: 'From a spreadsheet.',
              onSelect: options.alternative,
            },
          ]
        }
      />
    </ConnectorImportProvider>
  ));
  return { ...fake, open, onImported };
}

describe('connector import dialog', () => {
  it('lists every provider in the category with its connection state', () => {
    setup('files', { connected: ['dropbox'] });
    for (const provider of IMPORT_CATEGORIES.files.providers) {
      expect(screen.getByText(provider.name)).toBeTruthy();
    }
    expect(
      screen.getByRole('button', { name: 'Import from Dropbox' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    ).toBeTruthy();
    expect(screen.getByText(/Encrypted in transit and at rest/)).toBeTruthy();
  });

  it('connects an agent provider, then hands its import to a chat', async () => {
    const { context, open } = setup('tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    expect(context.connect).toHaveBeenCalledWith(
      { appSlug: 'jira', name: 'Jira' },
      expect.anything()
    );
    const importButton = await screen.findByRole('button', {
      name: 'Import from Jira',
    });
    fireEvent.click(importButton);
    await waitFor(() => expect(open()).toBe(false));
    expect(context.startAgentImport).toHaveBeenCalledWith(
      expect.objectContaining({
        input:
          'Import my most recent issues and tasks from Jira into Macro tasks.',
      })
    );
  });

  it('keeps an unfinished connection disconnected', async () => {
    const fake = setup('crm');
    fake.setConnectOutcome('closed');
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Connect HubSpot' })
      ).toHaveProperty('disabled', false)
    );
    expect(screen.queryByRole('button', { name: 'Import from HubSpot' })).toBe(
      null
    );
  });

  it('discovers, imports selected native items, and reports confirmed imports', async () => {
    const { context, setState, onImported } = setup('files', {
      connected: ['notion'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import from Notion' }));
    expect(screen.getByText('Import from Notion')).toBeTruthy();
    await waitFor(() =>
      expect(context.discover).toHaveBeenCalledWith('notion')
    );

    setState({
      runs: [importRunState({ source: 'notion', status: 'running' })],
      entities: [],
    });
    expect(
      screen.getByText(/Finding your recent pages and wikis/)
    ).toBeTruthy();

    setState({
      runs: [importRunState({ source: 'notion' })],
      entities: [
        importEntity({
          id: 'a',
          source: 'notion',
          metadata: { title: 'Plan' },
        }),
        importEntity({
          id: 'b',
          source: 'notion',
          metadata: { title: 'Notes' },
        }),
      ],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1' }));
    await waitFor(() => expect(context.runImport).toHaveBeenCalledWith(['a']));
    expect(onImported).not.toHaveBeenCalled();

    setState({
      runs: [importRunState({ source: 'notion' })],
      entities: [
        importEntity({
          id: 'a',
          source: 'notion',
          status: 'imported',
          metadata: { title: 'Plan' },
          entity_id: 'doc-1',
          entity_type: 'md',
        }),
        importEntity({
          id: 'b',
          source: 'notion',
          metadata: { title: 'Notes' },
        }),
      ],
    });
    expect(
      screen
        .getByRole('link', { name: 'Open imported Plan' })
        .getAttribute('href')
    ).toBe('/app/md/doc-1');
    expect(onImported).toHaveBeenCalled();
    expect(context.discover).toHaveBeenCalledTimes(1);
  });

  it('does not rediscover when items are already staged', async () => {
    const fake = fakeConnectorImport({ connected: ['linear'] });
    fake.setState({
      runs: [importRunState({ source: 'linear' })],
      entities: [
        importEntity({
          id: 'x',
          source: 'linear',
          metadata: { identifier: 'ENG-7', title: 'Ship it' },
        }),
      ],
    });
    render(() => (
      <ConnectorImportProvider context={fake.context}>
        <ConnectorImportDialog
          config={IMPORT_CATEGORIES.tasks}
          open
          onOpenChange={() => {}}
          onImported={() => {}}
        />
      </ConnectorImportProvider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Import from Linear' }));
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.getByText('ENG-7')).toBeTruthy();
    expect(fake.context.discover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to apps' }));
    expect(
      screen.getByRole('button', { name: 'Import from Linear' })
    ).toBeTruthy();
  });

  it('offers the host alternative and closes before running it', async () => {
    const alternative = vi.fn();
    const { open } = setup('crm', { alternative });
    fireEvent.click(screen.getByRole('button', { name: /Upload a CSV/ }));
    expect(alternative).toHaveBeenCalled();
    await waitFor(() => expect(open()).toBe(false));
  });
});
