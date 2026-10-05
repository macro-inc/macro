import { describe, expect, it } from 'vitest';
import { parseModel } from '../util/parse';
import {
  alternateProviderModel,
  DATABASE_MODEL,
  DEFAULT_MODEL,
  databaseModelForPlan,
  defaultModelForPlan,
  FREE_DEFAULT_MODEL,
  MODEL_PRETTYNAME,
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
    expect(paid).toEqual(Object.values(Model));
    expect(DEFAULT_MODEL).toBe(Model.sonnet55);
    expect(defaultModelForPlan(true)).toBe(DEFAULT_MODEL);
  });

  it('gives free users only the free model, defaulted to it', () => {
    const free = modelsForPlan(false);
    expect(free).toEqual([FREE_DEFAULT_MODEL]);
    expect(FREE_DEFAULT_MODEL).toBe(Model.haiku45);
    expect(defaultModelForPlan(false)).toBe(FREE_DEFAULT_MODEL);
    // The premium models are *not* in a free user's selectable set.
    expect(free).not.toContain(Model.sonnet55);
    expect(free).not.toContain(Model.opus55);
    expect(free).not.toContain(Model.gpt56);
    expect(free).not.toContain(Model.gpt6Astra);
  });

  it('offers only the current Anthropic generation', () => {
    const anthropic = Object.values(Model).filter(
      (id) => MODEL_PROVIDER[id] === 'anthropic'
    );
    expect(anthropic).toEqual([Model.sonnet55, Model.opus55, Model.haiku45]);
    expect(MODEL_PRETTYNAME[Model.sonnet55]).toBe('Sonnet 5.5');
    expect(MODEL_PRETTYNAME[Model.opus55]).toBe('Opus 5.5');
  });
});

describe('databaseModelForPlan', () => {
  it('asks a paid plan for the database model', () => {
    expect(databaseModelForPlan(true)).toBe(DATABASE_MODEL);
  });

  it('asks a free plan for its own model, which the service allows', () => {
    expect(databaseModelForPlan(false)).toBe(FREE_DEFAULT_MODEL);
  });
});

describe('modelUsageHint', () => {
  it('flags the heavy paid models and stays quiet for the default and cheaper', () => {
    expect(modelUsageHint(Model.gpt6Astra)).toBe('5× usage');
    expect(modelUsageHint(Model.gpt56)).toBe('3× usage');
    expect(modelUsageHint(Model.opus55)).toBe('2.5× usage');
    expect(modelUsageHint(Model.sonnet55)).toBeUndefined();
    expect(modelUsageHint(Model.haiku45)).toBeUndefined();
    expect(modelUsageHint(Model.gpt56Mini)).toBeUndefined();
  });
});

describe('parseModel', () => {
  it('passes through known model ids', () => {
    for (const id of Object.values(Model)) {
      expect(parseModel(id)).toBe(id);
    }
  });

  it('rejects unknown / empty values so callers can fall back to a default', () => {
    expect(parseModel('anthropic/claude-sonnet-5')).toBeUndefined(); // retired id
    expect(parseModel('anthropic/claude-opus-5')).toBeUndefined(); // retired id
    expect(parseModel('anthropic/claude-fable-5-1')).toBeUndefined(); // retired id
    expect(parseModel('gpt-5.6')).toBeUndefined(); // unprefixed / legacy
    expect(parseModel('not-a-model')).toBeUndefined();
    expect(parseModel('')).toBeUndefined();
    expect(parseModel(null)).toBeUndefined();
    expect(parseModel(undefined)).toBeUndefined();
  });
});

describe('alternateProviderModel', () => {
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
    const candidates: TModel[] = [Model.sonnet55, Model.gpt56Mini];
    const alt = alternateProviderModel(Model.opus55, { candidates });
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
      alternateProviderModel(Model.opus55, {
        candidates: [Model.sonnet55],
      })
    ).toBeUndefined();
  });

  it('remembers failures within a session, never re-suggesting a downed provider', () => {
    // Simulate a session where providers fail one after another. The caller
    // accumulates failed providers; the suggestion must avoid all of them, not
    // just the current model's provider.
    const candidates = [...Object.values(Model)] as TModel[];
    const failedProviders = new Set<string>();
    let current: TModel = Model.opus55; // anthropic

    // Anthropic has an outage → suggest a different provider.
    failedProviders.add(PROVIDER_OF(current));
    const first = alternateProviderModel(current, {
      candidates,
      failedProviders,
    });
    expect(first).toBeDefined();
    expect(PROVIDER_OF(first!)).toBe('openai');
    current = first!;

    // OpenAI then also fails → Google is the only provider left.
    failedProviders.add(PROVIDER_OF(current));
    const second = alternateProviderModel(current, {
      candidates,
      failedProviders,
    });
    expect(PROVIDER_OF(second!)).toBe('google');
    current = second!;

    // Google fails too → no un-failed provider is left, so we must NOT bounce
    // the user back to Anthropic (which already failed this session).
    failedProviders.add(PROVIDER_OF(current));
    const third = alternateProviderModel(current, {
      candidates,
      failedProviders,
    });
    expect(third).toBeUndefined();
  });

  it('still avoids the current provider when no failures are recorded', () => {
    const alt = alternateProviderModel(Model.opus55, {
      candidates: [...Object.values(Model)] as TModel[],
      failedProviders: new Set(),
    });
    expect(PROVIDER_OF(alt!)).toBe('openai');
  });
});
