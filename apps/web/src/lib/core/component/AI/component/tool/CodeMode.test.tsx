import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { executeCodeHandler } from './CodeMode';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

afterEach(cleanup);

it('settles a failed workspace run that has no response', () => {
  render(() => (
    <ToolErrorContext.Provider
      value={() => ({ kind: 'failed', reason: 'The program threw' })}
    >
      <Dynamic
        component={
          executeCodeHandler.render as Component<Record<string, unknown>>
        }
        tool={{ name: 'ExecuteCode', data: { source: 'main' } }}
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    </ToolErrorContext.Provider>
  ));
  expect(screen.getByText('Worked in your workspace')).toBeTruthy();
  expect(screen.queryByText('Working in your workspace')).toBeNull();
});

it('shows a chat code run as workspace work, without its program or result', () => {
  const source = 'return await macro.search({ query: "launch plan" });';
  const call = deserializeToolCall({
    id: 'run',
    name: 'ExecuteCode',
    json: { source, timeout_ms: 30000 },
  });
  const response = deserializeToolResponse({
    id: 'run',
    name: 'ExecuteCode',
    json: {
      status: 'succeeded',
      activity: [],
      activityTruncated: false,
      result: { documentId: 'doc-launch-plan' },
    },
  });
  if (call.isErr() || response.isErr()) {
    throw new Error('the chat ExecuteCode shapes did not parse');
  }

  const view = render(() => (
    <Dynamic
      component={
        executeCodeHandler.render as Component<Record<string, unknown>>
      }
      tool={call.value}
      response={response.value}
      renderContext={{
        isStreaming: false,
        grouped: false,
        followedBy: () => false,
      }}
    />
  ));

  const text = view.container.textContent ?? '';
  expect(text).toContain('Worked in your workspace');
  expect(text.toLowerCase()).not.toContain('code');
  expect(text).not.toContain('macro.search');
  expect(text).not.toContain('doc-launch-plan');
  expect(text).not.toMatch(/[{}]/);
});
