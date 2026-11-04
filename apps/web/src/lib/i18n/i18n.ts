import { makePersistedState } from '@app/lib/persistence';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';
import { createSignal, untrack } from 'solid-js';
import { z } from 'zod';
import type {
  PartialDictionary,
  PluralKey,
  TranslationKey,
  TranslationParams,
} from './dictionary';
import { formatMessage, lookupMessage, pluralForm } from './dictionary';
import { browserLanguage, DEFAULT_LANGUAGE, Language } from './languages';
import en from './locales/en';

const STORAGE_KEY = 'interface-language-v1';

const storedLanguageSchema = z.enum(Language);

type Translation = { default: PartialDictionary };

/** Translations load on demand so only the chosen language is downloaded. */
const TRANSLATIONS: Record<
  Exclude<Language, 'en'>,
  () => Promise<Translation>
> = {
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  es: () => import('./locales/es'),
  it: () => import('./locales/it'),
  nl: () => import('./locales/nl'),
  'pt-PT': () => import('./locales/pt-PT'),
  sv: () => import('./locales/sv'),
  da: () => import('./locales/da'),
  nb: () => import('./locales/nb'),
  fi: () => import('./locales/fi'),
  pl: () => import('./locales/pl'),
  ru: () => import('./locales/ru'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  'zh-Hans': () => import('./locales/zh-Hans'),
  'zh-Hant': () => import('./locales/zh-Hant'),
  hi: () => import('./locales/hi'),
  id: () => import('./locales/id'),
  vi: () => import('./locales/vi'),
  th: () => import('./locales/th'),
};

/** The browser's own locale, e.g. `en-GB` or `de-AT`. */
const browserLocale = navigator.language || DEFAULT_LANGUAGE;

/**
 * The browser's preferred language when the interface is offered in it. The
 * interface starts in it until the person or their team picks one.
 */
export const browserInterfaceLanguage = browserLanguage(
  navigator.languages?.length ? navigator.languages : [browserLocale]
);

// Remembered on the device so the next launch starts in the same language
// before the account's setting has loaded.
const [language, setLanguage] = makePersistedState(
  createSignal<Language>(browserInterfaceLanguage ?? DEFAULT_LANGUAGE),
  {
    storages: {
      restore: () => {
        try {
          const stored = storedLanguageSchema.safeParse(
            localStorage.getItem(STORAGE_KEY)
          );
          return stored.success ? stored.data : undefined;
        } catch {
          return undefined;
        }
      },
      write: (value) => {
        try {
          localStorage.setItem(STORAGE_KEY, value);
        } catch {
          // Storage may be unavailable; the language still applies this session.
        }
      },
    },
  }
);

const [translation, setTranslation] = createSignal<PartialDictionary>({});

/** The language the interface is currently shown in. */
export const interfaceLanguage = language;

/** Settles when the current language's messages are in place. */
let loading: Promise<void> = Promise.resolve();

/**
 * Switches the interface language. Messages stay in the previous language
 * until the new translation has loaded, then every `t` call updates.
 */
export function setInterfaceLanguage(next: Language): void {
  setLanguage(() => next);
  document.documentElement.lang = next;
  if (next === 'en') {
    setTranslation({});
    loading = Promise.resolve();
    return;
  }
  loading = loadTranslation(next);
  fireAndForget(loading, 'i18n');
}

/**
 * Settles once the interface language's messages have loaded, or after
 * `timeoutMs`. The first render waits on it so the app doesn't paint in
 * English and then switch; the timeout keeps a slow network from holding
 * back the first screen.
 */
export function interfaceLanguageReady(timeoutMs: number): Promise<void> {
  return Promise.race([
    loading,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function loadTranslation(next: Exclude<Language, 'en'>) {
  const loaded = await ResultAsync.fromPromise(
    TRANSLATIONS[next](),
    (error) => error
  );
  if (loaded.isErr()) {
    Telemetry.error(loaded.error, { surface: 'i18n', language: next });
    // Fall back to English rather than keep showing the previous language,
    // and try again once the connection is back. Adding the same handler
    // again is a no-op, so repeated failures share one retry.
    if (language() === next) setTranslation({});
    window.addEventListener('online', retryInterfaceLanguage, { once: true });
    return;
  }
  // A later switch may have finished first; only the current one applies.
  if (language() === next) setTranslation(loaded.value.default);
}

function retryInterfaceLanguage() {
  const current = language();
  if (current !== 'en') setInterfaceLanguage(current);
}

/**
 * The locale to format dates and numbers in: the browser's own when it is in
 * the interface language, so regional formats like `en-GB` or `de-AT` stay,
 * else the interface language. Pass it to `Intl` and `toLocale*String`
 * instead of leaving the locale out, which would follow the browser.
 */
export function formatLocale(): string {
  const current = language();
  return sameLanguage(browserLocale, current) ? browserLocale : current;
}

function sameLanguage(a: string, b: string): boolean {
  const [first, second] = [maximized(a), maximized(b)];
  return (
    first !== undefined &&
    first.language === second?.language &&
    first.script === second.script
  );
}

const maximizedLocales = new Map<string, Intl.Locale | undefined>();

function maximized(tag: string): Intl.Locale | undefined {
  if (!maximizedLocales.has(tag)) {
    let locale: Intl.Locale | undefined;
    try {
      locale = new Intl.Locale(tag).maximize();
    } catch {
      locale = undefined;
    }
    maximizedLocales.set(tag, locale);
  }
  return maximizedLocales.get(tag);
}

let englishOnly = false;

/**
 * Runs `read` with every `t` call answering in English. For values that must
 * not depend on the interface language — persisted ids, analytics — derived
 * from a label that is otherwise translated.
 */
export function inEnglish<T>(read: () => T): T {
  englishOnly = true;
  try {
    return untrack(read);
  } finally {
    englishOnly = false;
  }
}

/** A plural message needs its `count`; other messages take optional values. */
type MessageParams<K extends TranslationKey> = K extends PluralKey
  ? [params: TranslationParams & { count: number }]
  : [params?: TranslationParams];

/**
 * The message for `key` in the interface language, falling back to English,
 * with numbers written for {@link formatLocale}. A plural message picks the
 * form for `params.count`. Reactive: reading it inside JSX or a memo updates
 * when the language changes.
 */
export function t<K extends TranslationKey>(
  key: K,
  ...[params]: MessageParams<K>
): string {
  const translated = englishOnly
    ? undefined
    : lookupMessage(translation(), key);
  const message = translated ?? lookupMessage(en, key) ?? key;
  const template =
    typeof message === 'string'
      ? message
      : pluralForm(
          message,
          Number(params?.count ?? 0),
          translated ? language() : DEFAULT_LANGUAGE
        );
  return formatMessage(
    template,
    params,
    englishOnly ? DEFAULT_LANGUAGE : formatLocale()
  );
}

setInterfaceLanguage(language());
