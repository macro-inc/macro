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
import { fakeConnectorImport } from '../tests/fake-context';
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
  render(() => (
    <ConnectorImportProvider context={fake.context}>
      <ConnectorImportDialog
        config={IMPORT_CATEGORIES[category]}
        open={open()}
        onOpenChange={setOpen}
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
  return { ...fake, open };
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
      { appSlug: 'jira', name: 'Jira', mcpUrl: undefined },
      expect.anything()
    );
    const importButton = await screen.findByRole('button', {
      name: 'Import from Jira',
    });
    fireEvent.click(importButton);
    await waitFor(() => expect(open()).toBe(false));
    expect(context.startAgentImport).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Import my Jira workspace into Macro.',
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

  it("hands Notion to the agent's workspace importer", async () => {
    const { context, open } = setup('files', { connected: ['notion'] });
    fireEvent.click(screen.getByRole('button', { name: 'Import from Notion' }));
    await waitFor(() => expect(open()).toBe(false));
    expect(context.startAgentImport).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Import my Notion workspace into Macro.',
        instructions: expect.stringContaining('ImportFromNotion'),
      })
    );
  });

  it('connects GitHub through its native MCP server, not Pipedream', async () => {
    const fake = setup('tasks');
    fake.setConnectOutcome('started');
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(fake.context.connect).toHaveBeenCalledWith(
      {
        appSlug: 'github',
        name: 'GitHub',
        mcpUrl: 'https://api.githubcopilot.com/mcp',
      },
      expect.anything()
    );
    // Authorization finishes in another tab; the row waits for the result.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Connect GitHub' })
      ).toHaveProperty('disabled', false)
    );
    fake.setConnected(new Set(['github']));
    expect(
      await screen.findByRole('button', { name: 'Import from GitHub' })
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
