import { analytics } from '@app/lib/analytics';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../../routines/core/draft';
import { type SuggestionItem, suggestionItem } from '../core/suggestions';
import { context, forYou, TAGS, template } from '../tests/fixtures';
import {
  createSuggestionActions,
  type SuggestionActionsDeps,
} from './suggestion-actions';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

function item(suggestion = template): SuggestionItem {
  const result = suggestionItem(suggestion, [TAGS], context(false));
  if (!result) throw new Error('expected an item');
  return result;
}

function deps(overrides: Partial<SuggestionActionsDeps> = {}) {
  const created: ScheduleDraft[] = [];
  return {
    created,
    placement: () => ({ kind: 'sidebar' as const, surface: 'agents' as const }),
    create: vi.fn(async (draft: ScheduleDraft) => {
      created.push(draft);
      return 'routine-1';
    }),
    customize: vi.fn(),
    dismiss: vi.fn(async () => {}),
    notify: vi.fn(),
    ...overrides,
  };
}

function withActions(
  host: SuggestionActionsDeps,
  run: (actions: ReturnType<typeof createSuggestionActions>) => Promise<void>
) {
  return createRoot(async (dispose) => {
    await run(createSuggestionActions(host));
    dispose();
  });
}

beforeEach(() => vi.mocked(analytics.track).mockClear());

describe('suggestion actions', () => {
  it('enable in one click, once, with the row’s edits, and keep the row in place', async () => {
    const host = deps();
    await withActions(host, async (actions) => {
      const row = item();
      actions.edit(row, { ...actions.editsFor(row), title: 'My tags' });
      await Promise.all([actions.enable(row), actions.enable(row)]);
      expect(host.create).toHaveBeenCalledOnce();
      expect(host.created[0]).toMatchObject({
        name: 'My tags',
        enabled: true,
        suggestionId: 'template-1',
      });
      expect(actions.statusFor(row)).toEqual({
        kind: 'enabled',
        routineId: 'routine-1',
      });
      // The server drops a saved suggestion; its row stays to open it.
      expect(actions.visible([]).map((kept) => kept.id)).toEqual([
        'template-1',
      ]);
    });
    expect(analytics.track).toHaveBeenCalledWith('routine_suggestion_edited', {
      suggestionId: 'template-1',
      surface: 'agents',
      placement: 'sidebar',
      from: 'macro',
      kind: 'catalog',
      catalogKey: 'email_tags',
    });
    expect(analytics.track).toHaveBeenCalledWith(
      'routine_suggestion_enabled',
      expect.objectContaining({
        suggestionId: 'template-1',
        from: 'macro',
        routineId: 'routine-1',
        edited: true,
      })
    );
  });

  it('show why enabling failed on the row, and let the person try again', async () => {
    const host = deps({
      create: vi.fn(async () => {
        throw new Error('Scheduler unavailable');
      }),
    });
    await withActions(host, async (actions) => {
      const row = item();
      await actions.enable(row);
      expect(actions.statusFor(row)).toEqual({
        kind: 'failed',
        message: "Couldn't enable this routine. Scheduler unavailable",
      });
      expect(actions.visible([])).toEqual([]);
      actions.edit(row, actions.editsFor(row));
      expect(actions.statusFor(row).kind).toBe('idle');
    });
  });

  it('open the full editor prefilled with the row’s edits, saving nothing', async () => {
    const host = deps();
    await withActions(host, async (actions) => {
      const row = item(forYou);
      actions.edit(row, { ...actions.editsFor(row), notify: true });
      actions.customize(row);
    });
    expect(host.create).not.toHaveBeenCalled();
    expect(host.customize).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: 'pick-1',
        runVisibility: 'listed',
      })
    );
  });

  it('dismiss through the server, and say so when it refuses', async () => {
    const host = deps({
      dismiss: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await withActions(host, async (actions) => {
      await actions.dismiss(item(forYou));
    });
    expect(host.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pick-1' })
    );
    expect(host.notify).toHaveBeenCalledOnce();
    expect(analytics.track).toHaveBeenCalledWith(
      'routine_suggestion_dismissed',
      expect.objectContaining({ suggestionId: 'pick-1', from: 'for_you' })
    );
  });

  it('count a row shown once per list, by its main surface on the Routines page', async () => {
    const host = deps({ placement: () => ({ kind: 'routines' }) });
    await withActions(host, async (actions) => {
      const row = item(forYou);
      actions.shown(row);
      actions.shown(row);
    });
    expect(analytics.track).toHaveBeenCalledOnce();
    expect(analytics.track).toHaveBeenCalledWith(
      'routine_suggestion_shown',
      expect.objectContaining({ surface: 'email', placement: 'routines' })
    );
  });
});
