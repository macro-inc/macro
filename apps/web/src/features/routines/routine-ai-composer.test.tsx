import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from './core/routine-draft';
import { RoutineAiComposer } from './routine-ai-composer';

const compose = vi.hoisted(() => vi.fn());

vi.mock('./queries/compose-routine', () => ({ composeRoutine: compose }));
vi.mock('./queries/step-sources', () => ({
  useEmailLabelNames: () => () => [],
  useRoutineTags: () => () => [],
}));
vi.mock('../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({ roster: () => [] }),
}));
vi.mock('@core/auth', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@core/component/AI/constant', () => ({
  databaseModelForPlan: () => 'model',
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [] }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@property/editors/selectors/entityUtils', () => ({
  useQuickAccessEntities: () => ({ items: () => [] }),
}));

describe('routine AI composer', () => {
  it('drops a draft that arrives after the composer closed', async () => {
    let resolve!: (draft: unknown) => void;
    compose.mockReturnValue(new Promise((done) => (resolve = done)));
    const apply = vi.fn();
    const current = createEmptyDraft('model');
    const view = render(() => (
      <RoutineAiComposer
        apply={apply}
        current={() => current}
        defaultModel="model"
        decisionsEnabled
      />
    ));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Archive newsletters' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft it' }));
    expect(compose).toHaveBeenCalledOnce();

    view.unmount();
    resolve({ ...current, name: 'Late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
  });
});
