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
import { ImportJobsRailButton } from './import-jobs-tray';

afterEach(cleanup);

function tray(
  jobs: ImportJob[],
  handlers: { onOpen?: () => void; onReconnect?: () => void } = {}
) {
  render(() => (
    <ImportJobsRailButton
      jobs={jobs}
      open
      onOpenChange={vi.fn()}
      onOpen={handlers.onOpen ?? vi.fn()}
      onDismiss={vi.fn()}
      onReconnect={handlers.onReconnect ?? vi.fn()}
    />
  ));
}

describe('import jobs tray', () => {
  it('rings the rail button while an import moves, with no failure dot', () => {
    tray([
      {
        key: 'notion:running:1',
        source: 'notion',
        phase: { kind: 'importing', done: 1, total: 4 },
        sessionId: 'session',
        dismissable: false,
      },
    ]);
    const button = screen.getByRole('button', { name: '1 import' });
    expect(button.querySelector('svg circle')).toBeTruthy();
    expect(button.getAttribute('aria-description')).toBeNull();
    expect(within(button).queryByTestId('imports-failed-dot')).toBeNull();
  });

  it('shows nothing in the rail when there are no imports', () => {
    tray([]);
    expect(screen.queryByRole('button')).toBeNull();
  });

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
    expect(within(row).getByText('Failed: couldn’t use Notion')).toBeTruthy();
    expect(within(row).queryByRole('progressbar')).toBeNull();
    // Nothing is moving, so the rail button has no ring, but a failure dot.
    const button = screen.getByRole('button', { name: '1 import' });
    expect(button.querySelector('svg circle')).toBeNull();
    expect(button.getAttribute('aria-description')).toBe('An import failed');
    expect(within(button).getByTestId('imports-failed-dot')).toBeTruthy();
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

describe('failed import labels', () => {
  it('stay short enough for two lines beside the row actions', () => {
    for (const errorKind of [
      'not_found',
      'forbidden',
      'access_lost',
      'connection_unavailable',
      'not_connected',
      'rate_limited',
      'unreachable',
      'usage_refused',
      'interrupted',
      'internal',
      null,
    ] as const) {
      cleanup();
      tray([
        {
          key: `notion:failed:${errorKind}`,
          source: 'notion',
          phase: { kind: 'failed', errorKind },
          sessionId: undefined,
          dismissable: true,
        },
      ]);
      const row = screen.getByRole('listitem', { name: 'Notion' });
      const label = row.querySelector('[data-slot="item-description"]');
      expect(
        label?.textContent?.length ?? 0,
        String(errorKind)
      ).toBeLessThanOrEqual(40);
    }
  });
});
