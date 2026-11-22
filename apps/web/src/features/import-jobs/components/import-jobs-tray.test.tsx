/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '../core/import-job';
import { ImportJobsTray } from './import-jobs-tray';

afterEach(cleanup);

function tray(jobs: ImportJob[]) {
  render(() => (
    <ImportJobsTray
      jobs={jobs}
      expanded
      onExpandedChange={vi.fn()}
      onOpen={vi.fn()}
      onDismiss={vi.fn()}
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
