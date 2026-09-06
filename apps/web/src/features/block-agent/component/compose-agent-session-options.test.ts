import { describe, expect, it } from 'vitest';
import {
  harnessDisplayName,
  modelPillLabel,
  overrideModelOptions,
  type PersonaOption,
  personaDefaultLabel,
  shortlistModelOptions,
} from './compose-agent-session-options';

const MODELS = [
  { id: 'anthropic/claude-sonnet-5', name: 'Sonnet 5' },
  { id: 'anthropic/claude-opus-5', name: 'Opus 5' },
];

const CODER: PersonaOption = {
  id: 'macro-coder',
  name: 'Macro Coder',
  handle: 'coder',
  harness: 'sandbox',
};

const ENGINEER: PersonaOption = {
  ...CODER,
  id: 'bot-1',
  botId: 'bot-1',
  name: 'Test Engineer',
  handle: 'test-engineer',
  defaultModel: 'anthropic/claude-sonnet-5',
};

describe('overrideModelOptions', () => {
  it('lists every model when the persona has no default', () => {
    expect(overrideModelOptions(CODER, MODELS)).toEqual(MODELS);
  });

  it('drops the persona default so it is not offered twice', () => {
    expect(overrideModelOptions(ENGINEER, MODELS)).toEqual([MODELS[1]]);
  });
});

describe('harnessDisplayName', () => {
  it('names Macro runtimes as the Macro Agent', () => {
    expect(harnessDisplayName('in-memory')).toBe('Macro Agent');
    expect(harnessDisplayName('sandbox')).toBe('Macro Agent');
  });

  it('names the Cursor runtime as the Cursor Coder', () => {
    expect(harnessDisplayName('cursor')).toBe('Cursor Coder');
  });

  it('leaves registered harness names alone', () => {
    expect(harnessDisplayName('my-laptop')).toBe('my-laptop');
  });
});

describe('shortlistModelOptions', () => {
  it('shows a short list in full', () => {
    expect(shortlistModelOptions(ENGINEER, MODELS)).toEqual({
      featured: [MODELS[1]],
      more: [],
    });
  });

  it('caps a long catalog and keeps the rest behind more', () => {
    const catalog = [
      { id: 'auto', name: 'Auto' },
      { id: 'grok', name: 'Cursor Grok 4.6' },
      { id: 'opus', name: 'Claude Opus 5' },
      { id: 'opus-thinking', name: 'Claude Opus 5 Thinking' },
      { id: 'sonnet', name: 'Claude Sonnet 5' },
      { id: 'sonnet-thinking', name: 'Claude Sonnet 5 Thinking' },
      { id: 'gpt', name: 'GPT-5.6 Sol' },
      { id: 'gpt-fast', name: 'GPT-5.6 Sol Fast' },
      { id: 'gemini', name: 'Gemini 3.8 Flash' },
    ];
    const shortlist = shortlistModelOptions(CODER, catalog, 5);

    expect(shortlist.featured.map((model) => model.id)).toEqual([
      'auto',
      'grok',
      'opus',
      'sonnet',
      'gpt',
    ]);
    expect(shortlist.more.map((model) => model.id)).toEqual([
      'opus-thinking',
      'sonnet-thinking',
      'gpt-fast',
      'gemini',
    ]);
    expect(shortlist.featured.length + shortlist.more.length).toBe(
      catalog.length
    );
  });

  it('never features the persona default', () => {
    const catalog = Array.from({ length: 8 }, (_, index) => ({
      id: `m${index}`,
      name: `Model ${index}`,
    }));
    const persona = { ...CODER, defaultModel: 'm0' };
    const shortlist = shortlistModelOptions(persona, catalog, 3);

    expect(shortlist.featured).toHaveLength(3);
    expect(
      [...shortlist.featured, ...shortlist.more].some(
        (model) => model.id === 'm0'
      )
    ).toBe(false);
  });
});

describe('personaDefaultLabel', () => {
  it('is generic without a known default', () => {
    expect(personaDefaultLabel(CODER, MODELS)).toBe('Persona default');
  });

  it('names the default model when the persona has one', () => {
    expect(personaDefaultLabel(ENGINEER, MODELS)).toBe(
      'Persona default · Sonnet 5'
    );
  });

  it('falls back to the raw id for models the catalog does not know', () => {
    expect(
      personaDefaultLabel({ ...ENGINEER, defaultModel: 'acme/x' }, MODELS)
    ).toBe('Persona default · acme/x');
  });
});

describe('modelPillLabel', () => {
  it('shows the override when one is set', () => {
    expect(modelPillLabel('anthropic/claude-opus-5', ENGINEER, MODELS)).toBe(
      'Opus 5'
    );
  });

  it('shows the persona default otherwise', () => {
    expect(modelPillLabel('', ENGINEER, MODELS)).toBe('Sonnet 5');
  });

  it('shows a neutral label when nothing is known', () => {
    expect(modelPillLabel('', CODER, MODELS)).toBe('Default model');
  });
});
