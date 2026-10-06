import { describe, expect, it } from 'vitest';
import { parseModel } from '../util/parse';
import {
  alternateProviderModel,
  DEFAULT_MODEL,
  defaultModelForPlan,
  FREE_DEFAULT_MODEL,
  MODEL_PROVIDER,
  Model,
  modelsForPlan,
  modelUsageHint,
  PAID_MODELS,
  type TModel,
} from './model';

const PROVIDER_OF = (m: TModel) => MODEL_PROVIDER[m];

describe('modelsForPlan / defaultModelForPlan', () => {
  it('gives paid users every picker model and an Anthropic-smart default', () => {
    const paid = modelsForPlan(true);
    expect(paid).toEqual(PAID_MODELS);
    expect(paid).toContain(Model.gemini38Flash);
    expect(paid).toContain(Model.haiku45);
    expect(paid).not.toContain(Model.fable51);
    expect(DEFAULT_MODEL).toBe(Model.sonnet5);
    expect(defaultModelForPlan(true)).toBe(DEFAULT_MODEL);
  });

  it('gives free users only Gemini Flash, defaulted to it', () => {
    const free = modelsForPlan(false);
    expect(free).toEqual([Model.gemini38Flash]);
    expect(FREE_DEFAULT_MODEL).toBe(Model.gemini38Flash);
    expect(free).not.toContain(Model.haiku45);
    expect(defaultModelForPlan(false)).toBe(FREE_DEFAULT_MODEL);
    // The premium models are *not* in a free user's selectable set.
    expect(free).not.toContain(Model.opus5);
    expect(free).not.toContain(Model.gpt56);
  });
});

describe('modelUsageHint', () => {
  it('flags the heavy paid models and stays quiet for the default and cheaper', () => {
    expect(modelUsageHint(Model.fable51)).toBe('5× usage');
    expect(modelUsageHint(Model.gpt6Astra)).toBe('5× usage');
    expect(modelUsageHint(Model.opus5)).toBe('2.5× usage');
    expect(modelUsageHint(Model.sonnet5)).toBeUndefined();
    expect(modelUsageHint(Model.haiku45)).toBeUndefined();
  });

  it('removes Fable from plan options while keeping Astra paid-only', () => {
    expect(modelsForPlan(false)).not.toContain(Model.fable51);
    expect(modelsForPlan(false)).not.toContain(Model.gpt6Astra);
    expect(modelsForPlan(true)).not.toContain(Model.fable51);
    expect(modelsForPlan(true)).toContain(Model.gpt6Astra);
  });
});

describe('parseModel', () => {
  it('passes through known model ids', () => {
    for (const id of Object.values(Model)) {
      expect(parseModel(id)).toBe(id);
    }
  });

  it('rejects unknown / empty values so callers can fall back to a default', () => {
    expect(parseModel('anthropic/claude-opus-4-7')).toBeUndefined(); // retired id
    expect(parseModel('anthropic/claude-sonnet-4-6')).toBeUndefined(); // retired id
    expect(parseModel('gpt-5.6')).toBeUndefined(); // unprefixed / legacy
    expect(parseModel('not-a-model')).toBeUndefined();
    expect(parseModel('')).toBeUndefined();
    expect(parseModel(null)).toBeUndefined();
    expect(parseModel(undefined)).toBeUndefined();
  });
});

describe('alternateProviderModel', () => {
  it('does not offer a paid fallback when the free provider fails', () => {
    expect(
      alternateProviderModel(Model.gemini38Flash, {
        candidates: modelsForPlan(false),
      })
    ).toBeUndefined();
  });

  it('always suggests a model from a different provider than the current one', () => {
    for (const current of Object.values(Model)) {
      const alt = alternateProviderModel(current);
      expect(alt).toBeDefined();
      expect(PROVIDER_OF(alt!)).not.toBe(PROVIDER_OF(current));
    }
  });

  it('only ever suggests a model the user has access to (stays within candidates)', () => {
    // Candidates model the user's accessible models. The suggestion must be
    // one of them, never a model outside the accessible set.
    const candidates: TModel[] = [Model.haiku45, Model.gpt56Mini];
    const alt = alternateProviderModel(Model.opus5, { candidates });
    expect(candidates).toContain(alt);
    expect(PROVIDER_OF(alt!)).toBe('openai'); // the only different-provider candidate
  });

  it('returns undefined when no accessible model uses a different provider', () => {
    // User is on OpenAI but the only accessible model is also OpenAI — there is
    // no provider to fall back to.
    expect(
      alternateProviderModel(Model.gpt56, { candidates: [Model.gpt56Mini] })
    ).toBeUndefined();
    // Likewise when every candidate shares the current (Anthropic) provider.
    expect(
      alternateProviderModel(Model.opus5, {
        candidates: [Model.haiku45, Model.sonnet5],
      })
    ).toBeUndefined();
  });

  it('remembers failures within a session, never re-suggesting a downed provider', () => {
    // Simulate a session where providers fail one after another. The caller
    // accumulates failed providers; the suggestion must avoid all of them, not
    // just the current model's provider.
    const candidates = [...Object.values(Model)] as TModel[];
    const failedProviders = new Set<string>();
    let current: TModel = Model.opus5; // anthropic

    // Anthropic has an outage → suggest a different provider.
    failedProviders.add(PROVIDER_OF(current));
    const first = alternateProviderModel(current, {
      candidates,
      failedProviders,
    });
    expect(first).toBeDefined();
    expect(PROVIDER_OF(first!)).toBe('openai');
    current = first!;

    // OpenAI then also fails → Gemini is the remaining provider.
    failedProviders.add(PROVIDER_OF(current));
    const second = alternateProviderModel(current, {
      candidates,
      failedProviders,
    });
    expect(second).toBe(Model.gemini38Flash);
    failedProviders.add(PROVIDER_OF(second!));
    expect(
      alternateProviderModel(second!, { candidates, failedProviders })
    ).toBeUndefined();
  });

  it('still avoids the current provider when no failures are recorded', () => {
    const alt = alternateProviderModel(Model.opus5, {
      candidates: [...Object.values(Model)] as TModel[],
      failedProviders: new Set(),
    });
    expect(PROVIDER_OF(alt!)).toBe('openai');
  });
});
