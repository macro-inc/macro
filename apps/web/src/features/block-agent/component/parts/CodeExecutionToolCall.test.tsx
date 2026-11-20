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
          muted: false,
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

  it('shows one failed row for a program that ended before any step', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'failed',
          muted: true,
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
        error="ReferenceError: macro is not defined"
        loading={false}
        unavailable={false}
      />
    ));

    expect(view.container.textContent).toContain('Workspace activity');
    expect(view.container.textContent).toContain('Failed');
    expect(view.container.textContent).not.toContain('ReferenceError');
  });

  it('keeps a step failure on its own row when other steps ran', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'completed',
          muted: false,
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
  it('shows a loop over one operation as one row with its count', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'completed',
          muted: false,
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
          executionId: 'execution-4',
          source: 'export async function main() {}',
          status: 'succeeded',
          calls: [],
          activity: [
            { id: 0, label: 'Get Contacts', status: 'completed' },
            ...Array.from({ length: 127 }, (_, index) => ({
              id: index + 1,
              label: 'Get User Names With Email',
              status: 'completed' as const,
            })),
          ],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    const rows = [...view.container.querySelectorAll('[data-tool-status]')].map(
      (row) => row.textContent ?? ''
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Get User Names With Email');
    expect(rows[1]).toContain('×127');
  });
  it('says a folded run failed, or that its outcome is unknown, after its count', () => {
    const view = render(() => (
      <CodeExecutionToolCall
        common={{
          id: 'execute-code',
          label: 'ExecuteCode',
          status: 'failed',
          muted: false,
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
          executionId: 'execution-5',
          source: 'export async function main() {}',
          status: 'failed',
          calls: [],
          activity: [
            { id: 0, label: 'Get Thread', status: 'failed' },
            { id: 1, label: 'Get Thread', status: 'failed' },
            { id: 2, label: 'Get Thread', status: 'failed' },
            { id: 3, label: 'Read Message', status: 'unknown' },
            { id: 4, label: 'Read Message', status: 'unknown' },
          ],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    const rows = [
      ...view.container.querySelectorAll<HTMLElement>('[data-tool-status]'),
    ];
    expect(rows.map((row) => row.dataset.toolStatus)).toEqual([
      'failed',
      'completed',
    ]);
    expect(rows[0]?.textContent).toContain('×3 · Failed');
    expect(rows[1]?.textContent).toContain('×2 · Outcome unknown');
  });
});
