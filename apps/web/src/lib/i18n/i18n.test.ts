import { describe, expect, it } from 'vitest';
import type { PartialDictionary } from './dictionary';
import { formatMessage, lookupMessage } from './dictionary';
import { LANGUAGES, Language, resolveInterfaceLanguage } from './languages';
import en from './locales/en';

const translations = import.meta.glob<{ default: PartialDictionary }>(
  './locales/*.ts',
  { eager: true }
);

function translationFor(code: Language): PartialDictionary {
  const module = translations[`./locales/${code}.ts`];
  if (!module) throw new Error(`No translation file for ${code}`);
  return module.default;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

describe('resolveInterfaceLanguage', () => {
  it('prefers the person, then the team, then English', () => {
    expect(resolveInterfaceLanguage(Language.ja, Language.de)).toBe('ja');
    expect(resolveInterfaceLanguage(null, Language.de)).toBe('de');
    expect(resolveInterfaceLanguage(undefined, undefined)).toBe('en');
  });
});

describe('formatMessage', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(formatMessage('Go to {{label}}', { label: 'Email' })).toBe(
      'Go to Email'
    );
    expect(formatMessage('{{ count }} of {{total}}', { count: 2 })).toBe(
      '2 of {{total}}'
    );
  });
});

describe('lookupMessage', () => {
  it('falls through when a translation leaves a key out', () => {
    expect(lookupMessage({}, 'common.cancel')).toBeUndefined();
    expect(lookupMessage(en, 'common.cancel')).toBe('Cancel');
  });
});

describe('translations', () => {
  it('has a file for every language and nothing else', () => {
    const files = Object.keys(translations)
      .map((path) => path.replace('./locales/', '').replace('.ts', ''))
      .sort();
    expect(files).toEqual(LANGUAGES.map(({ code }) => code).sort());
  });

  // Missing and out-of-date translations fall back to English and are filled
  // in by the translation update (`bun run i18n:status`); these are the
  // mistakes that would show wrong text.
  it.each(
    LANGUAGES.filter(({ code }) => code !== 'en').map(({ code }) => code)
  )('%s only translates English messages, with their placeholders', (code) => {
    const translation = translationFor(code);
    const stray: string[] = [];
    const mismatched: string[] = [];
    for (const [namespace, messages] of Object.entries(translation)) {
      for (const [message, translated] of Object.entries(messages ?? {})) {
        const key = `${namespace}.${message}`;
        const english = (
          en[namespace as keyof typeof en] as Record<string, string> | undefined
        )?.[message];
        if (english === undefined) {
          stray.push(key);
          continue;
        }
        if (
          placeholders(translated ?? '').join() !== placeholders(english).join()
        ) {
          mismatched.push(key);
        }
      }
    }
    expect(stray).toEqual([]);
    expect(mismatched).toEqual([]);
  });
});
