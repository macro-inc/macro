/**
 * Reports which interface translations are missing or out of date, and records
 * the English each translation was made from.
 *
 *   bun run i18n:status                 every language, readable
 *   bun run i18n:status --json          the same, for an agent to work from
 *   bun run i18n:status --accept de     mark de's translations as current
 *   bun run i18n:status --accept all    mark every language's as current
 *
 * A translation is stale when the English it was made from has changed since.
 * `--accept` records the current English for every key the language
 * translates, so run it only after updating that language's stale keys.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PartialDictionary } from '../src/lib/i18n/dictionary';
import en from '../src/lib/i18n/locales/en';

const LOCALES = fileURLToPath(
  new URL('../src/lib/i18n/locales/', import.meta.url)
);
const SOURCES = `${LOCALES}translated-from.json`;
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * The English each translation was made from, as short hashes. `english` holds
 * the hash every language shares; `exceptions` lists only the languages whose
 * translation of a key came from different English.
 */
type Sources = {
  english: Record<string, string>;
  exceptions: Record<string, Record<string, string>>;
};

type LanguageStatus = {
  language: string;
  missing: { key: string; english: string }[];
  stale: { key: string; english: string; translation: string }[];
  placeholderMismatch: { key: string; english: string; translation: string }[];
};

const english = new Map(
  Object.entries(en).flatMap(([namespace, messages]) =>
    Object.entries(messages as Record<string, string>).map(
      ([message, text]) => [`${namespace}.${message}`, text] as const
    )
  )
);

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

function placeholders(text: string): string {
  return [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .sort()
    .join();
}

const languages = readdirSync(LOCALES)
  .filter((file) => file.endsWith('.ts') && file !== 'en.ts')
  .map((file) => file.replace(/\.ts$/, ''))
  .sort();

async function loadTranslation(
  language: string
): Promise<Map<string, string>> {
  const module: { default: PartialDictionary } = await import(
    `${LOCALES}${language}.ts`
  );
  return new Map(
    Object.entries(module.default).flatMap(([namespace, messages]) =>
      Object.entries((messages ?? {}) as Record<string, string>).map(
        ([message, text]) => [`${namespace}.${message}`, text] as const
      )
    )
  );
}

function readSources(): Sources {
  return JSON.parse(readFileSync(SOURCES, 'utf8')) as Sources;
}

function recorded(sources: Sources, language: string, key: string) {
  return sources.exceptions[language]?.[key] ?? sources.english[key];
}

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function writeSources(sources: Sources) {
  const exceptions = sortedObject(
    Object.entries(sources.exceptions)
      .map(([language, keys]): [string, Record<string, string>] => [
        language,
        sortedObject(Object.entries(keys)),
      ])
      .filter(([, keys]) => Object.keys(keys).length > 0)
  );
  const json = {
    english: sortedObject(Object.entries(sources.english)),
    exceptions,
  };
  writeFileSync(SOURCES, `${JSON.stringify(json, null, 2)}\n`);
}

async function status(language: string): Promise<LanguageStatus> {
  const translation = await loadTranslation(language);
  const sources = readSources();
  const result: LanguageStatus = {
    language,
    missing: [],
    stale: [],
    placeholderMismatch: [],
  };
  for (const [key, text] of english) {
    const translated = translation.get(key);
    if (!translated?.trim()) {
      result.missing.push({ key, english: text });
      continue;
    }
    if (recorded(sources, language, key) !== hash(text)) {
      result.stale.push({ key, english: text, translation: translated });
    }
    if (placeholders(translated) !== placeholders(text)) {
      result.placeholderMismatch.push({
        key,
        english: text,
        translation: translated,
      });
    }
  }
  return result;
}

async function accept(targets: string[]) {
  const sources = readSources();
  const translations = new Map(
    await Promise.all(
      languages.map(
        async (language) => [language, await loadTranslation(language)] as const
      )
    )
  );
  const next: Sources = { english: {}, exceptions: {} };
  for (const [key, text] of english) {
    const current = hash(text);
    const translating = languages.filter((language) =>
      translations.get(language)?.get(key)?.trim()
    );
    const madeFrom = new Map(
      translating.map((language) => [
        language,
        targets.includes(language)
          ? current
          : recorded(sources, language, key),
      ])
    );
    // Share the current English when every translation came from it;
    // otherwise keep the shared hash and list the languages that differ.
    const shared = [...madeFrom.values()].every((from) => from === current)
      ? current
      : (sources.english[key] ?? current);
    next.english[key] = shared;
    for (const [language, from] of madeFrom) {
      if (from === shared || from === undefined) continue;
      next.exceptions[language] ??= {};
      next.exceptions[language][key] = from;
    }
  }
  writeSources(next);
  console.log(`Recorded current English for ${targets.join(', ')}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const acceptIndex = args.indexOf('--accept');
  if (acceptIndex !== -1) {
    const target = args[acceptIndex + 1];
    const targets = target === 'all' ? languages : [target ?? ''];
    const unknown = targets.filter((language) => !languages.includes(language));
    if (unknown.length > 0) {
      console.error(
        `Unknown language ${unknown.join(', ')}; expected one of ${languages.join(', ')} or all.`
      );
      process.exit(1);
    }
    // A wrong placeholder shows broken text; fix it before calling it current.
    const mismatched = (await Promise.all(targets.map(status))).filter(
      ({ placeholderMismatch }) => placeholderMismatch.length > 0
    );
    if (mismatched.length > 0) {
      for (const { language, placeholderMismatch } of mismatched)
        for (const { key } of placeholderMismatch)
          console.error(`${language}: placeholders differ from English in ${key}`);
      process.exit(1);
    }
    await accept(targets);
    return;
  }

  const statuses = await Promise.all(languages.map(status));
  if (args.includes('--json')) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  for (const { language, missing, stale, placeholderMismatch } of statuses) {
    const problems = missing.length + stale.length + placeholderMismatch.length;
    if (problems === 0) {
      console.log(`${language}: up to date`);
      continue;
    }
    console.log(
      `${language}: ${missing.length} missing, ${stale.length} stale, ${placeholderMismatch.length} placeholder mismatches`
    );
    for (const { key } of missing) console.log(`  missing      ${key}`);
    for (const { key } of stale) console.log(`  stale        ${key}`);
    for (const { key } of placeholderMismatch)
      console.log(`  placeholders ${key}`);
  }
}

await main();
