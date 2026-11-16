import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { subagentHandler } from './Subagent';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('@core/component/AI/component/message/ChatMessageMarkdown', () => ({
  ChatMessageMarkdown: (props: { text: string }) => <p>{props.text}</p>,
}));
vi.mock('@entity/components/PulsingStar', () => ({
  PulsingStar: () => <span />,
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));
afterEach(cleanup);

const task =
  'Use the GitHub search tool (mcp__github__github-search-issues-and-pull-requests; load it via SearchTools "github search") to list every open pull request the user authored.\nGroup them by label.';

function subagent(data: unknown, result?: string) {
  return render(() => (
    <Dynamic
      component={subagentHandler.render as Component<Record<string, unknown>>}
      tool={{ name: 'Subagent', data }}
      response={
        result === undefined
          ? undefined
          : { name: 'Subagent', data: { result } }
      }
      renderContext={{
        isStreaming: result === undefined,
        grouped: false,
        followedBy: () => false,
      }}
    />
  ));
}

it('titles the row with the first line of the instructions', () => {
  subagent({ task });
  expect(screen.getByText(task.split('\n')[0])).toBeTruthy();
  expect(
    screen.queryByText('Group them by label.', { exact: false })
  ).toBeNull();
  expect(screen.getByText('Running')).toBeTruthy();
});

it('names the disclosure of a failed call, so assistive technology can open its instructions', () => {
  render(() => (
    <ToolErrorContext.Provider value={() => ({ kind: 'failed' })}>
      <Dynamic
        component={subagentHandler.render as Component<Record<string, unknown>>}
        tool={{ name: 'Subagent', data: { task } }}
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    </ToolErrorContext.Provider>
  ));
  for (const button of screen.getAllByRole('button')) {
    expect(button.textContent?.trim()).not.toBe('');
  }
});
