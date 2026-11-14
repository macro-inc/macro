import { analytics } from '@app/lib/analytics';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../../routines/core/draft';
import { withKnobValue } from '../../routines/core/knobs';
import {
  type SuggestionItem,
  suggestionItem,
  suggestionSentence,
  templateItem,
} from '../core/suggestions';
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
  const result = suggestionItem(suggestion, [TAGS], context(true));
  if (!result) throw new Error('expected an item');
  return result;
}

/** The card's knobs with one value changed, as its sentence would. */
function knobsWith(
  actions: ReturnType<typeof createSuggestionActions>,
  card: SuggestionItem,
  name: string,
  value: string | number
) {
  const sentence = suggestionSentence(card, actions.editsFor(card));
  if (!sentence) throw new Error('expected a sentence');
  return withKnobValue(sentence.knobs, name, value);
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
  it('turn on in one click, once, with the card’s knob values, and keep the card in place', async () => {
    const host = deps();
    await withActions(host, async (actions) => {
      const row = item();
      actions.editKnobs(row, knobsWith(actions, row, 'days', 30));
      await Promise.all([actions.enable(row), actions.enable(row)]);
      expect(host.create).toHaveBeenCalledOnce();
      expect(host.created[0]).toMatchObject({
        name: 'Tag new email',
        description: 'Tag each new email Reply within 30 days.',
        enabled: true,
        suggestionId: 'template-1',
      });
      const [step] = host.created[0]?.steps ?? [];
      expect(step?.kind === 'code' && step.knobs).toMatchObject([
        { name: 'replyTag', value: 'Reply' },
        { name: 'days', value: 30 },
      ]);
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

  it('show why turning on failed on the card, and let the person try again', async () => {
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
        message: 'Couldn’t turn on this routine. Scheduler unavailable',
      });
      expect(actions.visible([])).toEqual([]);
      actions.editKnobs(row, knobsWith(actions, row, 'days', 10));
      expect(actions.statusFor(row).kind).toBe('idle');
    });
  });

  it('open the full editor prefilled with the card’s knob values, saving nothing', async () => {
    const host = deps();
    await withActions(host, async (actions) => {
      const row = item(forYou);
      actions.editKnobs(row, knobsWith(actions, row, 'replyTag', 'Answer'));
      actions.customize(row);
    });
    expect(host.create).not.toHaveBeenCalled();
    expect(host.customize).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: 'pick-1',
        description: 'Tag each new email Answer within 14 days.',
      })
    );
  });

  it('leave templates out of suggestion events and dismissals', async () => {
    const host = deps();
    await withActions(host, async (actions) => {
      const card = templateItem(TAGS, context(true));
      actions.shown(card);
      await actions.dismiss(card);
      actions.customize(card);
    });
    expect(host.dismiss).not.toHaveBeenCalled();
    expect(host.customize).toHaveBeenCalledWith(
      expect.not.objectContaining({ suggestionId: expect.anything() })
    );
    expect(analytics.track).not.toHaveBeenCalled();
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

  it('count a card shown once per list, by its main surface on the Routines page', async () => {
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
