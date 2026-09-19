import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEditorSource } from '../context/editor-source';
import type { AgentDraft, ModelCatalog } from '../core/types';
import { createAgentDraft } from './create-agent-draft';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function setup(initial: Partial<AgentDraft> = {}, editing = false) {
  return createRoot((dispose) => {
    disposals.push(dispose);
    const [catalog, setCatalog] = createSignal<ModelCatalog>({
      state: 'available',
      currentModel: 'balanced',
      models: [{ id: 'balanced', name: 'Balanced' }],
    });
    const [pending, setPending] = createSignal(false);
    const save = vi.fn<AgentEditorSource['save']>(async () => true);
    const source: AgentEditorSource = {
      runtimes: () => [
        {
          id: 'in-memory',
          name: 'Macro',
          kind: 'builtin',
          description: 'Built in',
          target: { harness: 'in-memory' },
        },
      ],
      catalog,
      retryModels: async () => {},
      pending,
      save,
      canShareWithTeam: () => true,
      canMakePrivate: () => true,
      teamId: () => 'team-1',
    };
    const state = createAgentDraft(
      {
        name: 'Research assistant',
        handle: 'research-assistant',
        instructions: 'Compare sources.',
        runtimeId: 'in-memory',
        modelId: '',
        channelScope: 'all',
        channelIds: [],
        share: 'Private',
        apps: { scope: 'owner_connections' },
        ...initial,
      },
      source,
      editing
    );
    return { state, save, setCatalog, setPending };
  });
}

describe('createAgentDraft', () => {
  it('waits for model discovery and saves the advertised default when it arrives', async () => {
    const { state, save, setCatalog } = setup();
    setCatalog({ state: 'loading' });

    expect(state.modelId()).toBe('');
    expect(await state.save()).toBe(false);
    expect(save).not.toHaveBeenCalled();

    setCatalog({
      state: 'available',
      currentModel: 'reasoning',
      models: [
        { id: 'balanced', name: 'Balanced' },
        { id: 'reasoning', name: 'Reasoning' },
      ],
    });

    expect(state.modelId()).toBe('reasoning');
    expect(state.validation()).toBe('');
    expect(await state.save()).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ modelId: 'reasoning' })
    );
  });

  it('preserves the saved model when discovery replaces the available catalog', async () => {
    const { state, save, setCatalog } = setup(
      { modelId: 'retired-model' },
      true
    );
    setCatalog({ state: 'loading' });
    expect(state.modelId()).toBe('retired-model');

    setCatalog({
      state: 'available',
      currentModel: 'replacement',
      models: [{ id: 'replacement', name: 'Replacement' }],
    });

    expect(state.modelId()).toBe('retired-model');
    expect(state.modelOptions()).toContainEqual({
      id: 'retired-model',
      name: 'retired-model (saved, unavailable)',
    });
    expect(await state.save()).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ modelId: 'retired-model' })
    );
  });

  it('retains edits after a rejected write and retries the same draft', async () => {
    const { state, save } = setup();
    state.setName('Updated research assistant');
    state.update('instructions', 'Compare sources and include links.');
    const edited = state.draft();
    save.mockRejectedValueOnce(new Error('Service unavailable'));

    expect(await state.save()).toBe(false);
    expect(state.draft()).toEqual(edited);
    expect(state.dirty()).toBe(true);
    expect(state.busy()).toBe(false);
    expect(state.error()).toContain('Your changes are still here');

    expect(await state.save()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(state.error()).toBe('');
  });

  it('blocks duplicate writes before the source pending state catches up', async () => {
    const { state, save } = setup();
    let finishSave!: (saved: boolean) => void;
    save.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      })
    );

    const pendingSave = state.save();
    expect(state.busy()).toBe(true);
    expect(await state.save()).toBe(false);
    expect(save).toHaveBeenCalledOnce();

    finishSave(true);
    expect(await pendingSave).toBe(true);
    expect(state.busy()).toBe(false);
  });

  it('waits for the injected pending operation before starting another write', async () => {
    const { state, save, setPending } = setup();
    setPending(true);

    expect(state.busy()).toBe(true);
    expect(await state.save()).toBe(false);
    expect(save).not.toHaveBeenCalled();

    setPending(false);
    expect(await state.save()).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
});
