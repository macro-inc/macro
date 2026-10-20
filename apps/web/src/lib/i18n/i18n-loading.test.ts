import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoadState = 'loaded' | 'failing' | 'hanging';

const german = { default: { common: { cancel: 'Abbrechen' } } };
let state: LoadState = 'loaded';

async function startInGerman() {
  vi.resetModules();
  vi.doMock('./locales/de', () => {
    if (state === 'failing') throw new Error('offline');
    if (state === 'hanging') return new Promise(() => {});
    return german;
  });
  localStorage.setItem('interface-language-v1', 'de');
  return import('./i18n');
}

beforeEach(() => {
  state = 'loaded';
});

afterEach(() => {
  localStorage.clear();
  vi.doUnmock('./locales/de');
});

describe('interfaceLanguageReady', () => {
  it('settles once the remembered language has loaded', async () => {
    const i18n = await startInGerman();
    await i18n.interfaceLanguageReady(5000);
    expect(i18n.t('common.cancel')).toBe('Abbrechen');
  });

  it('gives up after the timeout and shows English', async () => {
    state = 'hanging';
    const i18n = await startInGerman();
    await i18n.interfaceLanguageReady(20);
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });
});

describe('a failed language load', () => {
  it('shows English and retries when the connection returns', async () => {
    state = 'failing';
    const i18n = await startInGerman();
    await i18n.interfaceLanguageReady(5000);
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(i18n.interfaceLanguage()).toBe('de');

    state = 'loaded';
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(i18n.t('common.cancel')).toBe('Abbrechen'));
  });
});
