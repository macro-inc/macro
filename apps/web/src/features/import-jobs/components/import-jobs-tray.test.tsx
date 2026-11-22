/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '../core/import-job';
import { ImportJobsTray } from './import-jobs-tray';

afterEach(cleanup);

function tray(
  jobs: ImportJob[],
  handlers: { onOpen?: () => void; onReconnect?: () => void } = {}
) {
  render(() => (
    <ImportJobsTray
      jobs={jobs}
      expanded
      onExpandedChange={vi.fn()}
      onOpen={handlers.onOpen ?? vi.fn()}
      onDismiss={vi.fn()}
      onReconnect={handlers.onReconnect ?? vi.fn()}
    />
  ));
}

describe('import jobs tray', () => {
  it('says why an import failed, with no progress ring', () => {
    tray([
      {
        key: 'notion:failed:1',
        source: 'notion',
        phase: { kind: 'failed', errorKind: 'connection_unavailable' },
        sessionId: undefined,
        dismissable: true,
      },
    ]);
    const row = screen.getByRole('listitem', { name: 'Notion' });
    expect(
      within(row).getByText(
        'Import failed: Macro couldn’t use your Notion connection'
      )
    ).toBeTruthy();
    expect(within(row).queryByRole('progressbar')).toBeNull();
    // Nothing is moving, so the pill has no ring either.
    expect(
      screen
        .getByRole('button', { name: 'Hide imports' })
        .querySelector('svg circle')
    ).toBeNull();
    expect(
      within(row).getByRole('button', { name: 'Dismiss the Notion import' })
    ).toBeTruthy();
  });

  it('keeps the plain label when the failure has no reason', () => {
    tray([
      {
        key: 'jira:failed:1',
        source: 'jira',
        phase: { kind: 'failed', errorKind: null },
        sessionId: undefined,
        dismissable: true,
      },
    ]);
    expect(screen.getByText('Import failed')).toBeTruthy();
  });
});

describe('a failed import offers what to do next', () => {
  it('offers to reconnect a lost connection', () => {
    const onReconnect = vi.fn();
    tray(
      [
        {
          key: 'notion:failed:1',
          source: 'notion',
          phase: { kind: 'failed', errorKind: 'access_lost' },
          sessionId: 'session-1',
          dismissable: true,
        },
      ],
      { onReconnect }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Notion' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull();
  });

  it('opens the review for any other failure', () => {
    const onOpen = vi.fn();
    tray(
      [
        {
          key: 'jira:failed:1',
          source: 'jira',
          phase: { kind: 'failed', errorKind: 'rate_limited' },
          sessionId: 'session-1',
          dismissable: true,
        },
      ],
      { onOpen }
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Reconnect/ })).toBeNull();
  });
});
