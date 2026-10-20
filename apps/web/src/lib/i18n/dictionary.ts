import type en from './locales/en';

/** The full message catalog; English defines its shape. */
export type Dictionary = typeof en;

/**
 * A translated catalog. Keys a translation leaves out fall back to English,
 * so a new English message never blocks a change; the translation update
 * (`bun run i18n:status`) fills them in.
 */
export type PartialDictionary = {
  [K in keyof Dictionary]?: { [M in keyof Dictionary[K]]?: string };
};

/** `namespace.message`, e.g. `nav.home`. */
export type TranslationKey = {
  [K in keyof Dictionary]: `${K & string}.${keyof Dictionary[K] & string}`;
}[keyof Dictionary];

export type TranslationParams = Record<string, string | number>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function lookupMessage(
  dictionary: PartialDictionary,
  key: TranslationKey
): string | undefined {
  const [namespace, message] = key.split('.') as [keyof Dictionary, string];
  const messages: Record<string, string | undefined> | undefined =
    dictionary[namespace];
  return messages?.[message];
}

/** Replaces `{{name}}` placeholders; unknown placeholders stay visible. */
export function formatMessage(
  template: string,
  params: TranslationParams | undefined
): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder
  );
}
