import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoadState = 'loaded' | 'failing' | 'hanging';

const german = {
  default: {
    common: { cancel: 'Abbrechen' },
    entityActions: {
      toastCopiedCount: {
        one: '{{count}} Element kopiert',
        other: '{{count}} Elemente kopiert',
      },
    },
  },
};
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

/** Loads the module fresh in a browser that prefers `languages`. */
async function startInBrowser(languages: string[], stored?: string) {
  vi.resetModules();
  vi.doMock('./locales/de', () => german);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0]);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  if (stored) localStorage.setItem('interface-language-v1', stored);
  return import('./i18n');
}

beforeEach(() => {
  state = 'loaded';
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.doUnmock('./locales/de');
});

describe('the first language', () => {
  it('follows the browser before anything is chosen', async () => {
    const i18n = await startInBrowser(['de-AT', 'en']);
    expect(i18n.browserInterfaceLanguage).toBe('de');
    expect(i18n.interfaceLanguage()).toBe('de');
  });

  it('keeps the language remembered on the device', async () => {
    const i18n = await startInBrowser(['de-AT'], 'en');
    expect(i18n.interfaceLanguage()).toBe('en');
  });

  it('is English for a browser language the app is not offered in', async () => {
    const i18n = await startInBrowser(['ar-EG']);
    expect(i18n.browserInterfaceLanguage).toBeUndefined();
    expect(i18n.interfaceLanguage()).toBe('en');
  });
});

describe('formatLocale', () => {
  it('keeps the browser locale when it is in the interface language', async () => {
    const i18n = await startInBrowser(['en-GB']);
    expect(i18n.formatLocale()).toBe('en-GB');
    i18n.setInterfaceLanguage('de');
    expect(i18n.formatLocale()).toBe('de');
  });

  it('keeps a regional variant of the interface language', async () => {
    const i18n = await startInBrowser(['de-AT']);
    expect(i18n.formatLocale()).toBe('de-AT');
  });

  it('tells Chinese scripts apart', async () => {
    const i18n = await startInBrowser(['zh-TW'], 'zh-Hans');
    expect(i18n.formatLocale()).toBe('zh-Hans');
  });
});

describe('plural messages', () => {
  it('pick the form for the count, in English and in the translation', async () => {
    const i18n = await startInBrowser(['en-US']);
    expect(i18n.t('entityActions.toastCopiedCount', { count: 1 })).toBe(
      'Copied 1 item'
    );
    expect(i18n.t('entityActions.toastCopiedCount', { count: 1234 })).toBe(
      'Copied 1,234 items'
    );
    i18n.setInterfaceLanguage('de');
    await i18n.interfaceLanguageReady(5000);
    expect(i18n.t('entityActions.toastCopiedCount', { count: 1 })).toBe(
      '1 Element kopiert'
    );
    expect(i18n.t('entityActions.toastCopiedCount', { count: 1234 })).toBe(
      '1.234 Elemente kopiert'
    );
  });
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
