import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CHANNEL, DEMO_TASKS } from '../core/workspace-demo';
import { createWorkspaceDemo } from './createWorkspaceDemo';

const disposals: (() => void)[] = [];
function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose);
    return createWorkspaceDemo();
  });
}
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
});

describe('local workspace demo', () => {
  it('preserves edits and messages across views without changing the fixtures', () => {
    const demo = setup();
    demo.setDocument('# My launch plan');
    demo.post('  Ready to launch  ');
    demo.post('   ');
    demo.toggleTask('release');
    demo.open('tasks');
    demo.open('documents');
    expect(demo.document()).toBe('# My launch plan');
    expect(demo.messages()).toHaveLength(DEMO_CHANNEL.length + 1);
    expect(demo.messages().at(-1)?.body).toBe('Ready to launch');
    expect(demo.tasks().find((task) => task.id === 'release')?.done).toBe(true);
    const fresh = setup();
    expect(fresh.messages()).toHaveLength(DEMO_CHANNEL.length);
    expect(fresh.tasks()).toEqual(DEMO_TASKS);
    expect(fresh.document()).not.toBe(demo.document());
  });

  it('keeps visited editors mounted and opens the channel from Home', () => {
    const demo = setup();
    demo.open('spreadsheet');
    demo.openSession('cursor');
    demo.open('home');
    expect(demo.navigation()).toBe('home');
    expect(demo.page()).toBe('messages');
    expect([...demo.visited()]).toEqual(['messages', 'spreadsheet', 'agents']);
    demo.open('agents');
    expect(demo.session()).toBe('roster');
  });

  it('delivers the sample response to its original session after navigation', () => {
    vi.useFakeTimers();
    const demo = setup();
    demo.ask('Ignored on the roster');
    demo.openSession('cursor');
    demo.ask('   ');
    demo.ask('What tests passed?');
    demo.ask('Ignored while a response is pending');
    demo.openSession('macro');
    expect(demo.replies()).toHaveLength(1);
    expect(demo.busy()).toBe(true);
    vi.advanceTimersByTime(650);
    expect(demo.replies()[0].session).toBe('cursor');
    expect(demo.replies()[0].answer).toContain('all 12 retry tests');
    expect(demo.busy()).toBe(false);
    demo.ask('Who owns the launch?');
    vi.advanceTimersByTime(650);
    expect(demo.replies()[1].session).toBe('macro');
    expect(demo.replies()[1].answer).toContain('**Julia**');
  });

  it('cancels pending replies when the preview unmounts', () => {
    vi.useFakeTimers();
    const demo = setup();
    demo.openSession('cursor');
    demo.ask('Check the tests');
    disposals.pop()?.();
    vi.advanceTimersByTime(1000);
    expect(demo.replies()[0].answer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
