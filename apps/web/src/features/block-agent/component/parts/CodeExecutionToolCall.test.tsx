/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeExecutionToolCall } from './CodeExecutionToolCall';

vi.mock('./MacroToolCall', () => ({ MacroToolCall: () => null }));

afterEach(cleanup);

describe('CodeExecutionToolCall', () => {
  it('shows a running program as its steps, with no group or card of its own', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'running',
          unsuccessful: false,
          stopped: false,
          trailing: undefined,
        }}
        context={{
          sessionId: 'session',
          messageId: 'session:turn-1',
          partIndex: 0,
          inFlight: true,
          followedBy: () => false,
        }}
        record={{
          executionId: 'execution-1',
          source: 'export async function main() {}',
          status: 'running',
          calls: [],
          activity: [
            { id: 0, label: 'Browse workspace', status: 'completed' },
            { id: 1, label: 'Search email', status: 'running' },
          ],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    expect(view.queryByRole('button')).toBeNull();
    expect(view.container.textContent).toContain('Browse workspace');
    expect(view.container.textContent).toContain('Search email');
    expect(view.container.textContent).not.toMatch(
      /Workspace activity|Working on it|export async/
    );
  });

  it('shows nothing for a program that ended before any step', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'failed',
          unsuccessful: true,
          stopped: false,
          trailing: 'Failed',
        }}
        context={{
          sessionId: 'session',
          messageId: 'session:turn-1',
          partIndex: 0,
          inFlight: false,
          followedBy: () => false,
        }}
        record={{
          executionId: 'execution-2',
          source: 'export async function main() {}',
          status: 'failed',
          error: 'ReferenceError: macro is not defined',
          calls: [],
          activity: [],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    expect(view.queryByTestId('tool-card')).toBeNull();
    expect(view.container.textContent).toBe('');
    // The failure stays in the record and telemetry, not the transcript.
    expect(
      view.container.querySelector('[data-code-execution]')
    ).not.toBeNull();
  });

  it('still says when its results are loading or unavailable', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'failed',
          unsuccessful: true,
          stopped: false,
          trailing: undefined,
        }}
        context={{
          sessionId: 'session',
          messageId: 'session:turn-1',
          partIndex: 0,
          inFlight: false,
          followedBy: () => false,
        }}
        loading
        unavailable
      />
    ));

    expect(view.queryByTestId('tool-card')).toBeNull();
    expect(view.getAllByRole('status').map((row) => row.textContent)).toEqual([
      'Loading tool results…',
      'Tool results are unavailable.',
    ]);
  });

  it('keeps a step failure on its own row when other steps ran', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'completed',
          unsuccessful: false,
          stopped: false,
          trailing: undefined,
        }}
        context={{
          sessionId: 'session',
          messageId: 'session:turn-1',
          partIndex: 0,
          inFlight: false,
          followedBy: () => false,
        }}
        record={{
          executionId: 'execution-3',
          source: 'export async function main() {}',
          status: 'succeeded',
          calls: [],
          activity: [
            { id: 0, label: 'Browse workspace', status: 'failed' },
            { id: 1, label: 'Browse workspace', status: 'completed' },
          ],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    expect(view.container.textContent).not.toContain('Workspace activity');
    expect(
      view.container.querySelectorAll('[data-tool-status="failed"]')
    ).toHaveLength(1);
  });
});
