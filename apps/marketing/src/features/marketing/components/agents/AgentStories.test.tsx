import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DummyWorkspace from '../workspace/DummyWorkspace';
import {
  AgentMcpDemo,
  AgentMemoryDemo,
  AgentModelsDemo,
  AgentSearchDemo,
} from './AgentStories';

let intersections: IntersectionObserverCallback[];
let reduced = false;
beforeEach(() => {
  intersections = [];
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => false);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
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
  vi.advanceTimersByTime(100);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visible() {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}

it('opens the hero on a cited conversation whose tasks open in place', () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const view = render(() => (
    <DummyWorkspace
      initialView="agents"
      initialAgent="launch-status"
      embedded
    />
  ));
  const log = within(view.getByRole('log', { name: 'Launch workspace' }));
  expect(log.getByText('What’s left before Thursday’s launch?')).toBeTruthy();
  expect(log.getByRole('button', { name: 'Called 3 tools' })).toBeTruthy();
  expect(log.getByText('20 messages')).toBeTruthy();
  fireEvent.click(
    log.getByRole('button', { name: 'Fix the team invite handoff' })
  );
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Fix the team invite handoff'
  );
});

it('calls tools one by one, then streams an answer that cites its sources', () => {
  const view = render(() => <AgentMemoryDemo />);
  const transcript = view.getByRole('log', { name: 'Northwind follow-up' });
  const log = within(transcript);
  expect(log.getByText('Thinking')).toBeTruthy();
  expect(log.queryByText('Read call transcript')).toBeNull();
  visible();
  vi.advanceTimersByTime(1000);
  expect(log.getByRole('button', { name: 'Calling 1 tool' })).toBeTruthy();
  expect(log.getByText('Northwind', { selector: 'span' })).toBeTruthy();
  vi.advanceTimersByTime(1500);
  expect(log.getByRole('button', { name: 'Calling 3 tools' })).toBeTruthy();
  expect(log.getByText('call transcript')).toBeTruthy();
  vi.advanceTimersByTime(800);
  expect(log.getByRole('button', { name: 'Called 3 tools' })).toBeTruthy();
  expect(log.queryByText(/assign it to her/)).toBeNull();
  vi.advanceTimersByTime(280 * 5);
  expect(log.getByText(/assign it to her/)).toBeTruthy();
  const citations = Array.from(
    transcript.querySelectorAll('[data-agent-mention]'),
    (element) => element.textContent
  );
  expect(citations).toContain('@Valentina');
  expect(citations).toContain('Re: Northwind pilot pricing');
  expect(citations).toContain('Northwind demo Tuesday at 2:00 PM');
});

it('opens the Search call’s hits across email, docs, channels, and calls', () => {
  reduced = true;
  const view = render(() => <AgentSearchDemo />);
  const toggle = view.getByRole('button', { name: '4 hits' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const kinds = Array.from(
    view.container.querySelectorAll('[data-search-hit]'),
    (hit) => hit.getAttribute('data-search-hit')
  );
  expect(kinds).toEqual(['email', 'document', 'channel', 'call']);
  fireEvent.click(toggle);
  expect(view.container.querySelector('[data-search-hit]')).toBeNull();
});

it('opens a cited email beside the session and closes it again', () => {
  const view = render(() => <AgentSearchDemo />);
  fireEvent.click(
    view.getByRole('button', { name: 'Next steps for our team' })
  );
  const opened = within(view.getByRole('region', { name: 'Opened item' }));
  expect(
    opened.getByRole('heading', { name: 'Next steps for our team' })
  ).toBeTruthy();
  expect(opened.getByText(/Could you share the rollout plan/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Close' }));
  expect(view.queryByRole('region', { name: 'Opened item' })).toBeNull();
  expect(
    view.getByRole('log', { name: 'Meadow before Thursday' })
  ).toBeTruthy();
});

it('switches to GPT-5.6 in the composer and answers from the same memory', () => {
  const view = render(() => <AgentModelsDemo />);
  expect(view.getByRole('button', { name: 'Model' }).textContent).toContain(
    'Sonnet 5.5'
  );
  visible();
  vi.advanceTimersByTime(1600);
  const menu = view.container.querySelector('.agent-model-menu');
  expect(
    Array.from(menu?.querySelectorAll('[data-model-option]') ?? [], (row) =>
      row.getAttribute('data-model-option')
    )
  ).toEqual([
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'gpt-5.6',
    'gemini-3.8-flash',
  ]);
  vi.advanceTimersByTime(1500);
  expect(view.container.querySelector('.agent-model-menu')).toBeNull();
  expect(view.getByRole('button', { name: 'Model' }).textContent).toContain(
    'GPT-5.6'
  );
  expect(view.getByText('Model set to GPT-5.6')).toBeTruthy();
  vi.advanceTimersByTime(2300);
  const log = view.getByRole('log', { name: 'Northwind follow-up' });
  expect(
    within(log).getAllByText('Who should own the Northwind follow-up?')
  ).toHaveLength(2);
  expect(within(log).getByText(/40-seat pricing herself/)).toBeTruthy();
});

it('shows the finished model switch for reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentModelsDemo />);
  expect(view.getByText('Model set to GPT-5.6')).toBeTruthy();
  expect(view.getByText(/40-seat pricing herself/)).toBeTruthy();
  expect(view.container.querySelector('.agent-model-menu')).toBeNull();
});

it('lists the MCP server’s real setup commands', () => {
  const view = render(() => <AgentMcpDemo />);
  expect(
    view.getByText(
      'claude mcp add --transport http macro https://mcp-server.macro.com/mcp'
    )
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'ChatGPT' }));
  expect(
    view.getByText(
      'Settings → Apps → Advanced settings → enable Developer mode, then Create App'
    )
  ).toBeTruthy();
});
