import { webcrypto } from 'node:crypto';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage, ImportSourceInputs } from '../context/contracts';
import { ImportProvider } from '../context/import-context';
import {
  archiveDiscovery,
  deferred,
  fakeImportSources,
  importLimits,
  importReceipt,
} from '../tests/fake-sources';
import { ImportDialog } from './import-dialog';

// Shared responsive Dialog needs a host platform; feature capabilities remain injected.
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function setup() {
  const fake = fakeImportSources();
  const [page, setPage] = createSignal<ImportPage>({
    jobs: [],
    limits: importLimits,
    sourceBinding: { kind: 'unbound' },
    nextCursor: undefined,
  });
  const [error, setError] = createSignal<Error>();
  let inputs!: ImportSourceInputs;
  const createSource = vi.fn((value: ImportSourceInputs) => {
    inputs = value;
    return { source: { ...fake.source, page, error }, commands: fake.commands };
  });
  const createArchive = vi.fn(() => fake.archive);
  const completed = vi.fn(async () => {});
  render(() => (
    <Suspense fallback={<p>Settings suspended</p>}>
      <ImportProvider
        context={{
          createSource,
          createArchive,
          protectFile: fake.protectFile,
          newToken: fake.newToken,
        }}
      >
        <ImportDialog
          teamId="team"
          onCompleted={completed}
          channelHref={(id) =>
            id === 'accessible' ? `/app/channel/${id}` : undefined
          }
        />
      </ImportProvider>
    </Suspense>
  ));
  const trigger = screen.getByRole('button', { name: 'Import from Slack' });
  trigger.focus();
  fireEvent.click(trigger);
  async function choose(): Promise<void> {
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Slack export ZIP')
      )
    );
    fireEvent.change(screen.getByLabelText('Slack export ZIP'), {
      target: { files: [new File(['zip'], 'slack.zip')] },
    });
    await screen.findByLabelText('Filter conversations');
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Choose another archive',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
  }
  return {
    fake,
    choose,
    page,
    setPage,
    setError,
    createSource,
    createArchive,
    completed,
    trigger,
    inputs: () => inputs,
  };
}

describe('Slack import dialog', () => {
  it('discovers locally, filters/groups selections and requires source confirmation before upload', async () => {
    const view = setup();
    const discovery = archiveDiscovery();
    discovery.conversations.push(
      {
        ...discovery.conversations[0],
        slackChannelId: 'COLD',
        name: 'old',
        archived: true,
      },
      {
        ...discovery.conversations[0],
        slackChannelId: 'D123',
        name: 'unsupported DM',
        kind: 'direct_message',
      }
    );
    view.fake.archive.discover.mockResolvedValue(discovery);
    expect(view.createArchive).not.toHaveBeenCalled();
    await view.choose();
    expect(view.fake.commands.create).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/old.*source members/)).toBeNull();
    expect(
      (screen.getByLabelText(/unsupported DM/) as HTMLInputElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('Select all visible conversations'));
    expect(screen.getByText(/1 selected/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show archived conversations'));
    fireEvent.input(screen.getByLabelText('Filter conversations'), {
      target: { value: 'old' },
    });
    fireEvent.click(screen.getByLabelText('Select all visible conversations'));
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Filter conversations'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByLabelText(/old.*source members/));
    expect(
      (
        screen.getByRole('button', {
          name: 'Import selected channels (1)',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByLabelText(/I confirm this archive/));
    fireEvent.click(screen.getByLabelText('Include message history'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected channels (1)' })
    );
    await waitFor(() =>
      expect(view.fake.commands.finalize).toHaveBeenCalledOnce()
    );
    expect(view.fake.commands.create.mock.calls[0][1]).toMatchObject({
      includeMessageHistory: false,
      source: { kind: 'confirmed_unknown' },
      conversations: [{ slackChannelId: 'C123' }],
    });
    expect(
      view.fake.archive.prepare.mock.calls[0][0].includeMessageHistory
    ).toBe(false);
    expect(screen.getByLabelText(/Upload:/)).toBeTruthy();
  });

  it('discards unconfirmed selection on close, makes no writes and restores focus on reopen', async () => {
    const view = setup();
    await view.choose();
    fireEvent.click(screen.getByLabelText('Select all visible conversations'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(view.trigger));
    fireEvent.click(view.trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Slack export ZIP')
      )
    );
    expect(screen.queryByLabelText('Filter conversations')).toBeNull();
    expect(view.fake.archive.discover).toHaveBeenCalledOnce();
    expect(view.fake.archive.dispose).toHaveBeenCalledOnce();
    expect(view.fake.commands.create).not.toHaveBeenCalled();
    expect(view.fake.commands.register).not.toHaveBeenCalled();
    expect(view.fake.commands.cancel).not.toHaveBeenCalled();
    expect(view.createSource).toHaveBeenCalledOnce();
  });

  it('confirms A/C by ID across filters, freezes review during creation and reopens persisted progress', async () => {
    const view = setup();
    const found = archiveDiscovery();
    found.conversations = ['CA', 'CB', 'CC'].map((slackChannelId) => ({
      ...found.conversations[0],
      slackChannelId,
      name: 'same name',
      folder: slackChannelId,
    }));
    view.fake.archive.discover.mockResolvedValue(found);
    view.fake.archive.prepare.mockImplementation(async (options) => {
      for (const slackChannelId of options.selectedIds)
        await options.seal({
          slackChannelId,
          partCount: 0,
          manifestSha256: 'b'.repeat(64),
        });
    });
    const created = deferred<ReturnType<typeof importReceipt>>();
    view.fake.commands.create.mockReturnValue(created.promise);
    await view.choose();
    fireEvent.click(screen.getByLabelText(/I confirm this archive/));
    expect(
      (
        screen.getByRole('button', {
          name: 'Import selected channels (0)',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    for (const id of ['CA', 'CC']) {
      fireEvent.input(screen.getByLabelText('Filter conversations'), {
        target: { value: id },
      });
      fireEvent.click(
        screen.getByLabelText('Select all visible conversations')
      );
    }
    fireEvent.input(screen.getByLabelText('Filter conversations'), {
      target: { value: 'CB' },
    });
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/same name.*CB/) as HTMLInputElement).checked
    ).toBe(false);
    fireEvent.input(screen.getByLabelText('Filter conversations'), {
      target: { value: '' },
    });
    const confirm = screen.getByRole('button', {
      name: 'Import selected channels (2)',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(view.fake.commands.create).toHaveBeenCalledOnce();
    expect(view.fake.commands.create.mock.calls[0][1].conversations).toEqual([
      found.conversations[0],
      found.conversations[2],
    ]);
    expect(screen.queryByLabelText('Filter conversations')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    created.resolve(
      importReceipt({
        conversations: ['CA', 'CC'].map((slackChannelId) => ({
          ...importReceipt().conversations[0],
          slackChannelId,
          name: `Saved ${slackChannelId}`,
          status: 'failed',
          error: 'invalid_input',
        })),
      })
    );
    await waitFor(() =>
      expect(view.fake.commands.finalize).toHaveBeenCalledOnce()
    );
    // The fake completion methods return their own receipt; publish the server's final snapshot.
    view.fake.setObserved(
      importReceipt({
        revision: 100,
        status: 'failed',
        conversations: ['CA', 'CC'].map((slackChannelId) => ({
          ...importReceipt().conversations[0],
          slackChannelId,
          name: `Saved ${slackChannelId}`,
          status: 'failed',
          error: 'invalid_input',
        })),
      })
    );
    fireEvent.click(view.trigger);
    await screen.findByText('Saved CA');
    expect(screen.getByText('Saved CC')).toBeTruthy();
    expect(screen.queryByLabelText('Filter conversations')).toBeNull();
    expect(view.fake.archive.discover).toHaveBeenCalledOnce();
  });

  it('cancels an unconfirmed review without creating or cancelling a server job', async () => {
    const view = setup();
    await view.choose();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await waitFor(() =>
      expect(view.fake.archive.dispose).toHaveBeenCalledOnce()
    );
    expect(view.fake.commands.create).not.toHaveBeenCalled();
    expect(view.fake.commands.cancel).not.toHaveBeenCalled();
    expect(view.fake.commands.register).not.toHaveBeenCalled();
  });

  it('keeps the dialog mounted through polling/errors and observes each terminal job once', async () => {
    const view = setup();
    const dialog = screen.getByRole('dialog');
    const processing = importReceipt({ status: 'processing' });
    view.setPage({ ...view.page(), jobs: [processing] });
    fireEvent.click(screen.getByRole('button', { name: /job · Processing/ }));
    const result = importReceipt({
      status: 'cancelled',
      revision: 8,
      conversations: [
        {
          ...processing.conversations[0],
          channelId: 'accessible',
          status: 'completed',
          counters: {
            processed: 12,
            imported: 9,
            skipped: 1,
            duplicates: 2,
            reactions: 3,
          },
        },
        {
          ...processing.conversations[0],
          slackChannelId: 'COTHER',
          channelId: 'inaccessible',
          status: 'skipped',
          warnings: ['target_unavailable'],
        },
      ],
    });
    view.fake.setObserved(result);
    view.setPage({ ...view.page(), jobs: [result] });
    await waitFor(() => expect(view.completed).toHaveBeenCalledOnce());
    const channelLink = screen.getByRole('link');
    channelLink.focus();
    view.fake.setObserved({
      ...result,
      revision: 9,
      conversations: structuredClone(result.conversations),
    });
    expect(document.activeElement).toBe(channelLink);
    view.setError(new Error('offline'));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.queryByText('Settings suspended')).toBeNull();
    expect(view.completed).toHaveBeenCalledOnce();
    expect(screen.getByText(/9 imported/)).toBeTruthy();
    expect(screen.getByText('Target unavailable')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/app/channel/accessible'
    );
    expect(screen.getByText(/Cancellation is not rollback/)).toBeTruthy();
  });

  it('can cancel while uploading and keeps committed partial counts visible', async () => {
    const view = setup();
    const upload = deferred<'uploaded'>();
    view.fake.put.mockImplementation(async (_, options) => {
      options?.onProgress?.({ kind: 'bytes', loaded: 1, total: 2 });
      options?.signal?.addEventListener(
        'abort',
        () => upload.reject(new Error('aborted')),
        { once: true }
      );
      return upload.promise;
    });
    await view.choose();
    fireEvent.click(screen.getByLabelText('Select all visible conversations'));
    fireEvent.click(screen.getByLabelText(/I confirm this archive/));
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected channels (1)' })
    );
    await waitFor(() => expect(view.fake.put).toHaveBeenCalled());
    expect(screen.getByLabelText(/Upload:/).getAttribute('value')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await waitFor(() =>
      expect(view.fake.commands.cancel).toHaveBeenCalledOnce()
    );
    expect(view.fake.commands.finalize).not.toHaveBeenCalled();
  });

  it('finalizes a historical upload with skips without creating an archive worker', async () => {
    const view = setup();
    view.setPage({ ...view.page(), jobs: [importReceipt()] });
    fireEvent.click(screen.getByRole('button', { name: /job · Uploading/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Finalize with skips' })
    );
    await waitFor(() =>
      expect(view.fake.commands.finalize).toHaveBeenCalledWith({
        teamId: 'team',
        jobId: 'job',
      })
    );
    expect(view.createArchive).not.toHaveBeenCalled();
    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.getByText(/With message history/)).toBeTruthy();
  });

  it('shows actionable errors for historical cancellation and supports history pagination', async () => {
    const view = setup();
    view.setPage({
      ...view.page(),
      jobs: [importReceipt()],
      nextCursor: 'cursor',
    });
    fireEvent.click(screen.getByRole('button', { name: /job · Uploading/ }));
    view.fake.commands.cancel.mockRejectedValue(new Error('request failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await screen.findByText(/Cancellation was not confirmed/);
    fireEvent.click(screen.getByRole('button', { name: 'Older imports' }));
    expect(view.inputs().before?.()).toBe('cursor');
    fireEvent.click(screen.getByRole('button', { name: 'Newest imports' }));
    expect(view.inputs().before?.()).toBeUndefined();
  });
});
