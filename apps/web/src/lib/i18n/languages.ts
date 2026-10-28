import { Language } from '@service-auth/generated/schemas/language';
import { match } from 'ts-pattern';

export { Language };

export const DEFAULT_LANGUAGE: Language = Language.en;

/**
 * The interface languages in picker order, each with its name written in that
 * language so people can find their own regardless of the current one.
 */
export const LANGUAGES: readonly { code: Language; nativeName: string }[] = [
  { code: Language.en, nativeName: 'English' },
  { code: Language.de, nativeName: 'Deutsch' },
  { code: Language.fr, nativeName: 'Français' },
  { code: Language.es, nativeName: 'Español' },
  { code: Language.it, nativeName: 'Italiano' },
  { code: Language.nl, nativeName: 'Nederlands' },
  { code: Language['pt-PT'], nativeName: 'Português (Portugal)' },
  { code: Language.sv, nativeName: 'Svenska' },
  { code: Language.da, nativeName: 'Dansk' },
  { code: Language.nb, nativeName: 'Norsk bokmål' },
  { code: Language.fi, nativeName: 'Suomi' },
  { code: Language.pl, nativeName: 'Polski' },
  { code: Language.ru, nativeName: 'Русский' },
  { code: Language.ja, nativeName: '日本語' },
  { code: Language.ko, nativeName: '한국어' },
  { code: Language['zh-Hans'], nativeName: '简体中文' },
  { code: Language['zh-Hant'], nativeName: '繁體中文' },
  { code: Language.hi, nativeName: 'हिन्दी' },
  { code: Language.id, nativeName: 'Bahasa Indonesia' },
  { code: Language.vi, nativeName: 'Tiếng Việt' },
  { code: Language.th, nativeName: 'ไทย' },
];

const LANGUAGE_CODES: ReadonlySet<string> = new Set(Object.values(Language));

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGUAGE_CODES.has(value);
}

export function nativeLanguageName(code: Language): string {
  return (
    LANGUAGES.find((language) => language.code === code)?.nativeName ?? code
  );
}

/**
 * The first of the browser's preferred languages (`navigator.languages`) that
 * the interface is offered in, matched by language and script: `de-AT` is
 * German, `zh-TW` Traditional Chinese, `no` Norwegian bokmål. Brazilian
 * Portuguese gets European Portuguese, the closest one offered. A preference
 * for English ahead of the others stops the search.
 */
export function browserLanguage(
  preferred: readonly string[]
): Language | undefined {
  for (const tag of preferred) {
    const match = offeredLanguage(tag);
    if (match) return match;
  }
  return undefined;
}

function offeredLanguage(tag: string): Language | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag).maximize();
  } catch {
    return undefined;
  }
  return match(locale.language)
    .with('zh', () =>
      locale.script === 'Hant' ? Language['zh-Hant'] : Language['zh-Hans']
    )
    .with('pt', () => Language['pt-PT'])
    .with('no', 'nn', () => Language.nb)
    .otherwise((language) => (isLanguage(language) ? language : undefined));
}

/**
 * The language the interface shows: the person's own choice, else their
 * team's, else the browser's, else English.
 */
export function resolveInterfaceLanguage(
  userLanguage: Language | null | undefined,
  teamLanguage: Language | null | undefined,
  browser: Language | undefined
): Language {
  return userLanguage ?? teamLanguage ?? browser ?? DEFAULT_LANGUAGE;
}
