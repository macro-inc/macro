import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
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

it('parses calls with and without a description, so saved calls still render', () => {
  for (const json of [
    { task },
    { description: 'List open pull requests', task },
  ]) {
    const parsed = deserializeToolCall({ id: 'call', name: 'Subagent', json });
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap().data).toEqual(json);
  }
});
