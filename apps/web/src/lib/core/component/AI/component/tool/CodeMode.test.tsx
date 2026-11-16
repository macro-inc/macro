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
