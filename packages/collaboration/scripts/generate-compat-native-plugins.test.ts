import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateNativePluginSchema,
  parseEmittedTransformerSymbols,
  parseShortcutIdentities,
} from './generate-compat-native-plugins';

const source = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../crates/client/lexical/macro_document_model/src/plugins_group_a/shortcuts/transformer_ids.rs'
  ),
  'utf8'
);
const symbols = parseEmittedTransformerSymbols(
  readFileSync(
    resolve(import.meta.dirname, '../src/session/compatibility.generated.ts'),
    'utf8'
  )
);

describe('source native plugin identities', () => {
  test('preserves the complete catalog order and reserves zero for rejection', () => {
    const identities = parseShortcutIdentities(source);
    expect(identities).toHaveLength(95);
    const generated = generateNativePluginSchema(source, symbols);
    expect(generated.schema).toContain('Unknown = 0;');
    expect(generated.schema).toContain('IDatabaseQueryBlock = 1;');
    for (const [index, identity] of identities.entries()) {
      expect(generated.schema).toContain(`${identity.variant} = ${index + 1};`);
      expect(generated.typescript).toContain(
        `[${JSON.stringify(identity.name)}, CompatShortcutTransformer.${symbols.get(index + 1)}]`
      );
    }
    expect(generated.typescript).toContain(
      "if (id === undefined) throw new Error('Unknown native shortcut transformer')"
    );
  });

  test('uses compiler acronym spelling and rejects a stale emitted enum', () => {
    const generated = generateNativePluginSchema(source, symbols);
    expect(generated.typescript).toContain('CompatShortcutTransformer.HR]');
    expect(() =>
      generateNativePluginSchema(source, new Map([[0, 'Unknown']]))
    ).toThrow('Regenerate');
    expect(() =>
      parseEmittedTransformerSymbols(
        'enum CompatShortcutTransformer { Unknown=0, Other=0 }'
      )
    ).toThrow('numeric ID');
  });

  test('refuses untyped or unmapped additions instead of silently omitting them', () => {
    const position = source.indexOf(
      '\n}',
      source.indexOf('pub enum ShortcutTransformerId {')
    );
    expect(() =>
      parseShortcutIdentities(
        source.slice(0, position) + '\n    Unmapped,\n' + source.slice(position)
      )
    ).toThrow('Unsupported');
    expect(() =>
      parseShortcutIdentities(
        source.replace('pub enum ShortcutTransformerId {', 'pub enum Other {')
      )
    ).toThrow('Expected one');
  });

  test('rejects inconsistent names and duplicate numeric identities', () => {
    expect(() =>
      parseShortcutIdentities(
        source.replace(
          'strum(serialize = "I_DATABASE_QUERY_BLOCK")',
          'strum(serialize = "CODE")'
        )
      )
    ).toThrow('inconsistent');
    expect(() =>
      parseShortcutIdentities(
        source.replaceAll('I_DATABASE_QUERY"', 'I_DATABASE_QUERY_BLOCK"')
      )
    ).toThrow('Duplicate');
  });
});
