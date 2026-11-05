import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { subagentHandler } from './Subagent';

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

it('titles the row with the short description, not the instructions', () => {
  subagent({ description: 'List open pull requests', task });
  expect(screen.getByText('List open pull requests')).toBeTruthy();
  expect(screen.queryByText(task, { exact: false })).toBeNull();
  expect(screen.getByText('Running')).toBeTruthy();
});

it('keeps the instructions and the result behind the disclosure', () => {
  subagent(
    { description: 'List open pull requests', task },
    'Three open pull requests.'
  );
  expect(screen.getByText('Done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Instructions')).toBeTruthy();
  expect(screen.getByText(task, { normalizer: (text) => text })).toBeTruthy();
  expect(screen.getByText('Result')).toBeTruthy();
  expect(screen.getByText('Three open pull requests.')).toBeTruthy();
});

it("titles a call without a description by its instructions' first line", () => {
  subagent({ task }, 'Three open pull requests.');
  expect(
    screen.getByText(
      'Use the GitHub search tool (mcp__github__github-search-issues-and-pull-requests; load it via SearchTools "github search") to list every open pull request the user authored.'
    )
  ).toBeTruthy();
});
