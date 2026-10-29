import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { toRoutineSuggestions } from '../queries/suggestion-wire';
import { createSuggestionActions } from './suggestion-actions';

const [suggestion] = toRoutineSuggestions(
  [
    {
      surface: 'tasks',
      title: 'Follow-ups after calls',
      summary: 'Creates follow-up tasks when a call ends.',
      reason: 'You run many customer calls',
      instructions: 'Create a task for each action item from the call.',
      icon: 'task',
      keepProbability: 0.9,
      affectsOthers: false,
      notify: false,
      trigger: { kind: 'event', event: 'call.ended' },
    },
  ],
  'UTC'
);

function setup(
  create: (name: string) => Promise<string>,
  existing = [] as { id: string; name: string }[]
) {
  return createRoot(() =>
    createSuggestionActions({
      target: () => ({ kind: 'model', model: 'anthropic/claude-sonnet-4-5' }),
      existingRoutines: () => existing,
      create: (draft) => create(draft.name),
      customize: vi.fn(),
    })
  );
}

describe('createSuggestionActions', () => {
  it('creates one routine with the edited name however often Enable is pressed', async () => {
    let finish: (id: string) => void = () => {};
    const create = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve))
    );
    const actions = setup(create);
    actions.edit(suggestion, {
      ...actions.editsFor(suggestion),
      title: 'Call follow-ups',
    });
    const first = actions.enable(suggestion);
    const second = actions.enable(suggestion);
    expect(actions.statusFor(suggestion)).toEqual({ kind: 'enabling' });
    finish('routine-1');
    await Promise.all([first, second]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('Call follow-ups');
    expect(actions.statusFor(suggestion)).toEqual({
      kind: 'enabled',
      routineId: 'routine-1',
    });
    await actions.enable(suggestion);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reports a failed enable and allows another try after an edit', async () => {
    const create = vi
      .fn<(name: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValueOnce('routine-2');
    const actions = setup(create);
    await actions.enable(suggestion);
    expect(actions.statusFor(suggestion)).toEqual({
      kind: 'failed',
      message: "Couldn't enable this routine. Server down",
    });
    actions.edit(suggestion, actions.editsFor(suggestion));
    expect(actions.statusFor(suggestion)).toEqual({ kind: 'idle' });
    await actions.enable(suggestion);
    expect(actions.statusFor(suggestion)).toEqual({
      kind: 'enabled',
      routineId: 'routine-2',
    });
  });

  it('reads a suggestion the user already has as enabled', async () => {
    const create = vi.fn(async () => 'never');
    const actions = setup(create, [
      { id: 'existing', name: 'follow-ups after calls ' },
    ]);
    expect(actions.statusFor(suggestion)).toEqual({
      kind: 'enabled',
      routineId: 'existing',
    });
    await actions.enable(suggestion);
    expect(create).not.toHaveBeenCalled();
  });
});
