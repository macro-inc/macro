import { describe, expect, it } from 'vitest';
import type {
  ImportDroppedPart,
  ImportFormat,
  ImportItemKind,
  ImportSkipReason,
  ParsedImport,
  ParsedImportFolder,
  ParsedImportItem,
} from './types';
import SAMPLE from './wire-sample.json';

/**
 * `wire-sample.json` is the wasm adapter's real output for the synthetic
 * Bitwarden fixture (a Rust test keeps it so). These lists are checked by the
 * compiler to name every field and value `types.ts` declares, so a field or
 * value added on either side fails here.
 */
function keysOf<T>() {
  return <const Keys extends readonly (keyof T)[]>(
    keys: Keys &
      ([Exclude<keyof T, Keys[number]>] extends [never] ? unknown : never)
  ) => [...keys].map(String).sort();
}
function valuesOf<T extends string>() {
  return <const Values extends readonly T[]>(
    values: Values &
      ([Exclude<T, Values[number]>] extends [never] ? unknown : never)
  ) => new Set<string>(values);
}

const EXPORT_KEYS = keysOf<ParsedImport>()([
  'format',
  'summary',
  'folders',
  'items',
  'skipped',
  'dropped',
]);
const SUMMARY_KEYS = keysOf<ParsedImport['summary']>()([
  'itemsByKind',
  'folders',
  'skippedByReason',
  'droppedByPart',
]);
const FOLDER_KEYS = keysOf<ParsedImportFolder>()([
  'key',
  'name',
  'parentKey',
  'path',
]);
const ITEM_KEYS = keysOf<ParsedImportItem>()([
  'sourceKey',
  'name',
  'kind',
  'url',
  'folderKey',
  'favorite',
  'values',
  'totp',
]);
const VALUE_KEYS = keysOf<ParsedImportItem['values']>()([
  'username',
  'password',
  'notes',
  'fields',
]);
const FIELD_KEYS = keysOf<ParsedImportItem['values']['fields'][number]>()([
  'label',
  'value',
]);
const SKIPPED_KEYS = keysOf<ParsedImport['skipped'][number]>()([
  'sourceKey',
  'name',
  'reason',
]);
const DROPPED_KEYS = keysOf<ParsedImport['dropped'][number]>()([
  'sourceKey',
  'what',
  'count',
]);

const FORMATS = valuesOf<ImportFormat>()([
  'one_password_pux',
  'one_password_csv',
  'bitwarden_json',
  'bitwarden_csv',
]);
const KINDS = valuesOf<ImportItemKind>()([
  'login',
  'card',
  'note',
  'identity',
  'api',
  'verification_code',
]);
const SKIP_REASONS = valuesOf<ImportSkipReason>()([
  'trashed',
  'archived',
  'attachment',
  'passkey',
  'shared_collection',
  'unsupported_category',
  'too_large',
  'malformed',
]);
const DROPPED_PARTS = valuesOf<ImportDroppedPart>()([
  'attachment',
  'passkey',
  'password_history',
  'totp_non_default',
  'extra_field',
]);

const keys = (value: object) => Object.keys(value).sort();

describe('the wasm wire shape', () => {
  it('has the fields and values types.ts declares', () => {
    expect(SAMPLE.outcome).toBe('parsed');
    const parsed = SAMPLE.export;
    expect(keys(parsed)).toEqual(EXPORT_KEYS);
    expect(FORMATS.has(parsed.format)).toBe(true);

    expect(keys(parsed.summary)).toEqual(SUMMARY_KEYS);
    for (const kind of Object.keys(parsed.summary.itemsByKind))
      expect(KINDS.has(kind)).toBe(true);
    for (const reason of Object.keys(parsed.summary.skippedByReason))
      expect(SKIP_REASONS.has(reason)).toBe(true);
    for (const part of Object.keys(parsed.summary.droppedByPart))
      expect(DROPPED_PARTS.has(part)).toBe(true);

    expect(parsed.folders.length).toBeGreaterThan(0);
    for (const folder of parsed.folders)
      expect(keys(folder)).toEqual(FOLDER_KEYS);

    expect(parsed.items.length).toBeGreaterThan(0);
    for (const item of parsed.items) {
      expect(keys(item)).toEqual(ITEM_KEYS);
      expect(KINDS.has(item.kind)).toBe(true);
      expect(keys(item.values)).toEqual(VALUE_KEYS);
      for (const field of item.values.fields)
        expect(keys(field)).toEqual(FIELD_KEYS);
    }

    expect(parsed.skipped.length).toBeGreaterThan(0);
    for (const skipped of parsed.skipped) {
      expect(keys(skipped)).toEqual(SKIPPED_KEYS);
      expect(SKIP_REASONS.has(skipped.reason)).toBe(true);
    }
    expect(parsed.dropped.length).toBeGreaterThan(0);
    for (const dropped of parsed.dropped) {
      expect(keys(dropped)).toEqual(DROPPED_KEYS);
      expect(DROPPED_PARTS.has(dropped.what)).toBe(true);
    }
  });
});
