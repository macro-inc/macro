import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { codeRunLabel, executeCodeHandler } from './CodeMode';
import { type ToolEnding, ToolErrorContext } from './ToolRenderer';

vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

afterEach(cleanup);

function renderRun(props: { response?: unknown; ending?: ToolEnding }) {
  render(() => (
    <ToolErrorContext.Provider value={() => props.ending}>
      <Dynamic
        component={
          executeCodeHandler.render as Component<Record<string, unknown>>
        }
        tool={{ name: 'ExecuteCode', data: { source: 'main' } }}
        response={props.response}
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    </ToolErrorContext.Provider>
  ));
}

it('reads a workspace run that has not ended as working', () => {
  renderRun({});
  expect(screen.getByText('Working on it')).toBeTruthy();
});

it('reads a workspace run with a response as a finished step', () => {
  renderRun({ response: { data: { status: 'succeeded' } } });
  expect(screen.getByText('Finished a step')).toBeTruthy();
});

it('reads a workspace run whose program failed as a failed step', () => {
  renderRun({
    response: { data: { status: 'timed_out', error: 'Out of time' } },
  });
  expect(screen.getByText('A step failed')).toBeTruthy();
});

it('reads a stopped workspace run as an interrupted step', () => {
  renderRun({ ending: { kind: 'stopped' } });
  expect(screen.getByText('Step interrupted')).toBeTruthy();
});

it('settles a failed workspace run that has no response', () => {
  renderRun({ ending: { kind: 'failed', reason: 'The program threw' } });
  expect(screen.getByText('A step failed')).toBeTruthy();
  expect(screen.queryByText('Working on it')).toBeNull();
});

it('reads a code run that ended in a call error as a failed step', () => {
  expect(codeRunLabel(undefined, { kind: 'failed' })).toBe('A step failed');
  expect(codeRunLabel({ status: 'succeeded' }, undefined)).toBe(
    'Finished a step'
  );
  expect(codeRunLabel({ status: 'cancelled' }, undefined)).toBe(
    'Step interrupted'
  );
});
