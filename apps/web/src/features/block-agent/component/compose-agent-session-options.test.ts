import { describe, expect, it } from 'vitest';
import {
  modelPillLabel,
  overrideModelOptions,
  type PersonaOption,
  personaDefaultLabel,
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
