import type en from './locales/en';

/** The full message catalog; English defines its shape. */
export type Dictionary = typeof en;

/**
 * A message that changes with a number, one form per plural category of the
 * language (`Intl.PluralRules`), chosen by the `count` parameter. English
 * writes `one` and `other`; Polish and Russian also need `few` and `many`.
 */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

type Message = string | PluralMessage;

/**
 * A translated catalog. Keys a translation leaves out fall back to English,
 * so a new English message never blocks a change; the translation update
 * (`bun run i18n:status`) fills them in. A plural message stays plural.
 */
export type PartialDictionary = {
  [K in keyof Dictionary]?: {
    [M in keyof Dictionary[K]]?: Dictionary[K][M] extends string
      ? string
      : PluralMessage;
  };
};

/** `namespace.message`, e.g. `nav.home`. */
export type TranslationKey = {
  [K in keyof Dictionary]: `${K & string}.${keyof Dictionary[K] & string}`;
}[keyof Dictionary];

/** Keys whose message is plural, so `t` needs a `count`. */
export type PluralKey = {
  [K in keyof Dictionary]: {
    [M in keyof Dictionary[K]]: Dictionary[K][M] extends string
      ? never
      : `${K & string}.${M & string}`;
  }[keyof Dictionary[K]];
}[keyof Dictionary];

export type TranslationParams = Record<string, string | number>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function lookupMessage(
  dictionary: PartialDictionary,
  key: TranslationKey
): Message | undefined {
  const [namespace, message] = key.split('.') as [keyof Dictionary, string];
  const messages: Record<string, Message | undefined> | undefined =
    dictionary[namespace];
  return messages?.[message];
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** The form of `message` for `count` in `language`, else its `other` form. */
export function pluralForm(
  message: PluralMessage,
  count: number,
  language: string
): string {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return message[rules.select(count)] ?? message.other;
}

/**
 * Replaces `{{name}}` placeholders, writing numbers for `locale`
 * (`1.234` in German). Unknown placeholders stay visible.
 */
export function formatMessage(
  template: string,
  params: TranslationParams | undefined,
  locale?: string
): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (!(name in params)) return placeholder;
    const value = params[name];
    return typeof value === 'number'
      ? value.toLocaleString(locale)
      : String(value);
  });
}
