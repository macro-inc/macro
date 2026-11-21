import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { StorageOpKind, StorageOpMsg } from './abi.generated';
import { decodeStorageOperation } from './storage';

const fixtures: { name: string; bytes: number[] }[] = JSON.parse(
  readFileSync(
    new URL(
      '../../../../crates/client/document_session_wasm/src/test/fixtures/storage-abi-v2.json',
      import.meta.url
    ),
    'utf8'
  )
);
const kinds = [
  StorageOpKind.Load,
  StorageOpKind.LoadOrphans,
  StorageOpKind.WalAppend,
  StorageOpKind.WalMarkDelivered,
  StorageOpKind.WalPrune,
  StorageOpKind.WalAdopt,
  StorageOpKind.WalDropExpired,
  StorageOpKind.WalQuarantine,
  StorageOpKind.SnapshotSave,
  StorageOpKind.SnapshotDelete,
];

test('generated storage codec reads and writes every original one-byte ABI payload', () => {
  expect(fixtures).toHaveLength(10);
  for (const [tag, fixture] of fixtures.entries()) {
    const bytes = new Uint8Array(fixture.bytes);
    const decoded = decodeStorageOperation(bytes);
    expect(bytes[0]).toBe(tag);
    expect(decoded.kind).toBe(kinds[tag]);
    expect(StorageOpKind[decoded.kind]).toBe(fixture.name);
    expect(decoded.doc).toBe('fixture-document');
    expect(StorageOpMsg.encode(decoded).slice()).toEqual(bytes);
  }
});

test('unknown tags and truncated storage payloads fail at the decode boundary', () => {
  for (const fixture of fixtures) {
    const bytes = new Uint8Array(fixture.bytes);
    for (const kind of [10, 255]) {
      const unknown = bytes.slice();
      unknown[0] = kind;
      expect(() => decodeStorageOperation(unknown)).toThrow();
    }
    expect(() =>
      decodeStorageOperation(new Uint8Array([...bytes, 0]))
    ).toThrow();
    for (const length of [0, 1, bytes.length - 1])
      expect(() => decodeStorageOperation(bytes.slice(0, length))).toThrow();
  }
});
