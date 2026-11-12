/** @vitest-environment jsdom */

import { publishSessionActivity } from '@core/agent-session/session-activity';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeExecutionToolCall } from './CodeExecutionToolCall';

vi.mock('./MacroToolCall', () => ({ MacroToolCall: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CodeExecutionToolCall', () => {
  it('names a running program with the session line in place of "Calling N tools"', () => {
    publishSessionActivity('running-program', 'Searching your workspace (3)…');

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
          sessionId: 'running-program',
          messageId: 'running-program:turn-1',
          partIndex: 0,
          inFlight: true,
          followedBy: () => false,
          current: true,
        }}
        record={{
          executionId: 'execution-1',
          source: 'export async function main() {}',
          status: 'running',
          calls: [],
          activity: [
            { id: 0, label: 'Search workspace', status: 'completed' },
            { id: 1, label: 'Search workspace', status: 'running' },
          ],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    const group = view.getByRole('button');
    expect(group.textContent).toContain('Searching your workspace (3)…');
    expect(group.textContent).not.toContain('Calling');
  });

  it('shows the session line on the workspace card before any request is observed', () => {
    publishSessionActivity('starting-program', 'Running code…');

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
          sessionId: 'starting-program',
          messageId: 'starting-program:turn-1',
          partIndex: 0,
          inFlight: true,
          followedBy: () => false,
          current: true,
        }}
        record={{
          executionId: 'execution-2',
          source: 'export async function main() {}',
          status: 'running',
          calls: [],
          activity: [],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    expect(view.container.textContent).toContain('Running code…');
  });

  it('keeps the tool count on a program the turn has moved past', () => {
    publishSessionActivity('finished-program', 'Searching your workspace (8)…');

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
          sessionId: 'finished-program',
          messageId: 'finished-program:turn-1',
          partIndex: 0,
          inFlight: true,
          followedBy: () => false,
          current: false,
        }}
        record={{
          executionId: 'execution-3',
          source: 'export async function main() {}',
          status: 'succeeded',
          calls: [],
          activity: [{ id: 0, label: 'Search workspace', status: 'completed' }],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    const group = view.getByRole('button');
    expect(group.textContent).toContain('Called 1 tool');
    expect(group.textContent).not.toContain('Searching your workspace');
  });

  it('keeps the line on the newest program while the agent thinks after it', () => {
    publishSessionActivity(
      'thinking-after-program',
      'Searching your workspace (4)…'
    );

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
          sessionId: 'thinking-after-program',
          messageId: 'thinking-after-program:turn-1',
          partIndex: 0,
          inFlight: true,
          followedBy: () => false,
          current: true,
        }}
        record={{
          executionId: 'execution-4',
          source: 'export async function main() {}',
          status: 'succeeded',
          calls: [],
          activity: [{ id: 0, label: 'Search workspace', status: 'completed' }],
        }}
        loading={false}
        unavailable={false}
      />
    ));

    const group = view.getByRole('button');
    expect(group.textContent).toContain('Searching your workspace (4)…');
    expect(group.textContent).not.toContain('Called');
  });
});
