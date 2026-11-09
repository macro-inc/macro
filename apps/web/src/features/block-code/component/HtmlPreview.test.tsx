import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserExecutionReceipt } from '../queries/document-programs';
import { ProgramFrame } from './HtmlPreview';

const runDocumentProgram = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<UserExecutionReceipt>>()
);

vi.mock('../queries/document-programs', () => ({ runDocumentProgram }));
vi.mock('../code-mode/event-host', () => ({ attachEventHost: () => () => {} }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      operation: (span: { setAttr: () => void; error: () => void }) => unknown
    ) => operation({ setAttr: () => {}, error: () => {} }),
  },
}));

const failed = (error: string): UserExecutionReceipt => ({
  status: 'failed',
  activity: [],
  activityTruncated: false,
  error,
});

/** Send a run request as the preview frame's page would. */
function runFromPage(program: string, id: number) {
  const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement;
  const srcdoc = frame.getAttribute('srcdoc') ?? '';
  const token = /\}\)\(parent, "([^"]+)"\)/.exec(srcdoc)?.[1];
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'macro:run', token, id, program, arguments: {} },
      source: frame.contentWindow,
    })
  );
}

describe('ProgramFrame', () => {
  afterEach(() => {
    cleanup();
    runDocumentProgram.mockReset();
  });

  it('shows the latest failed run until dismissed', async () => {
    runDocumentProgram
      .mockResolvedValueOnce(failed('tasks is not a function'))
      .mockResolvedValueOnce(failed('The program timed out.'));
    render(() => (
      <ProgramFrame
        documentId="doc"
        html="<p>Page</p>"
        sourceHash="hash"
        onStale={() => {}}
      />
    ));
    expect(screen.queryByRole('alert')).toBeNull();

    runFromPage('tasks', 1);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'tasks is not a function'
    );

    runFromPage('tasks', 2);
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The program timed out.'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
