import type { QueuedActionDto } from '@service-agent-harness/generated/schemas';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSteering } from './steer';

const first: QueuedActionDto = {
  actionId: 'first',
  kind: 'prompt',
  prompt: 'First',
  attachments: [],
  actorUserId: null,
  createdAt: '2026-10-02T00:00:00Z',
};
const second: QueuedActionDto = {
  actionId: 'second',
  kind: 'prompt',
  prompt: 'Second',
  attachments: [],
  actorUserId: null,
  createdAt: '2026-10-02T00:00:01Z',
};
const third: QueuedActionDto = {
  actionId: 'third',
  kind: 'prompt',
  prompt: 'Third',
  attachments: [],
  actorUserId: null,
  createdAt: '2026-10-02T00:00:02Z',
};
const fourth: QueuedActionDto = {
  actionId: 'fourth',
  kind: 'prompt',
  prompt: 'Fourth',
  attachments: [],
  actorUserId: null,
  createdAt: '2026-10-02T00:00:03Z',
};

describe('createSteering', () => {
  it('shows three consecutive force-sends at once and steers each exactly once, in press order', async () => {
    const [serverQueue, setServerQueue] = createSignal([
      first,
      second,
      third,
      fourth,
    ]);
    const [speculated, setSpeculated] = createSignal<string[]>([]);
    const firstSteer = Promise.resolve(true);
    const secondSteer = Promise.resolve(true);
    const thirdSteer = Promise.resolve(true);
    const steer = vi
      .fn<(actionId: string) => Promise<boolean>>()
      .mockReturnValueOnce(firstSteer)
      .mockReturnValueOnce(secondSteer)
      .mockReturnValueOnce(thirdSteer);
    const expectAction = vi.fn((actionId: string) =>
      setSpeculated((current) => [...current, actionId])
    );
    const entries = () =>
      serverQueue().filter((entry) => !speculated().includes(entry.actionId));
    const steering = createRoot(() =>
      createSteering({
        entries,
        waiting: (actionId) =>
          serverQueue().some((entry) => entry.actionId === actionId),
        steer,
        expect: expectAction,
        retract: vi.fn(),
      })
    );

    steering.steer('first');
    steering.steer('second');
    steering.sendNext();
    steering.steer('first');

    expect(expectAction.mock.calls).toEqual([
      ['first', { type: 'prompt', prompt: 'First' }],
      ['second', { type: 'prompt', prompt: 'Second' }],
      ['third', { type: 'prompt', prompt: 'Third' }],
    ]);
    expect(entries()).toEqual([fourth]);
    expect(steer.mock.calls).toEqual([['first']]);

    await firstSteer;
    expect(steer.mock.calls).toEqual([['first']]);
    setServerQueue([second, third, fourth]);
    expect(steer.mock.calls).toEqual([['first'], ['second']]);

    await secondSteer;
    setServerQueue([third, fourth]);
    expect(steer.mock.calls).toEqual([['first'], ['second'], ['third']]);

    await thirdSteer;
    setServerQueue([fourth]);
    expect(steer.mock.calls).toEqual([['first'], ['second'], ['third']]);
    expect(steering.failed().size).toBe(0);
  });

  it('keeps a refused force-send queued with an error and steers the next one', async () => {
    const [serverQueue] = createSignal([first, second]);
    const [speculated, setSpeculated] = createSignal<string[]>([]);
    const refused = Promise.resolve(false);
    const accepted = Promise.resolve(true);
    const steer = vi
      .fn<(actionId: string) => Promise<boolean>>()
      .mockReturnValueOnce(refused)
      .mockReturnValueOnce(accepted);
    const retract = vi.fn((actionId: string) =>
      setSpeculated((current) => current.filter((id) => id !== actionId))
    );
    const entries = () =>
      serverQueue().filter((entry) => !speculated().includes(entry.actionId));
    const steering = createRoot(() =>
      createSteering({
        entries,
        waiting: (actionId) =>
          serverQueue().some((entry) => entry.actionId === actionId),
        steer,
        expect: (actionId) =>
          setSpeculated((current) => [...current, actionId]),
        retract,
      })
    );

    steering.steer('first');
    steering.steer('second');
    expect(entries()).toEqual([]);

    await refused;

    expect(retract).toHaveBeenCalledWith('first');
    expect(entries()).toEqual([first]);
    expect([...steering.failed()]).toEqual(['first']);
    expect(steer.mock.calls).toEqual([['first'], ['second']]);

    steering.steer('first');
    expect(steering.failed().size).toBe(0);
  });
});
