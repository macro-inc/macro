import { expect, test } from 'vitest';
import { ABI_MAJOR, EditorInputMsg } from './abi.generated';
import legacy from './paste-intent.legacy.json';

test('legacy paste branch four remains byte-identical at ABI two', () => {
  expect(ABI_MAJOR).toBe(2);
  expect(legacy.abi).toBe(2);
  const encoded = EditorInputMsg.encode(
    EditorInputMsg.fromEditorPaste(legacy.payload)
  ).slice();
  expect([...encoded]).toEqual(legacy.bytes);
  const decoded = EditorInputMsg.decode(encoded).data;
  expect(decoded.discriminator).toBe(4);
  if (decoded.discriminator !== 4) throw new Error('Expected legacy paste');
  expect(decoded.value.clipboard).toEqual(legacy.payload.clipboard);
  expect(decoded.value.htmlNodes).toEqual(legacy.payload.htmlNodes);
  expect(decoded.value.hasFiles).toBe(true);
  expect('intent' in decoded.value).toBe(false);
});

test.each([true, false])(
  'typed paste branch ten carries plainOnly=%s without changing rich data',
  (plainOnly) => {
    const encoded = EditorInputMsg.encode(
      EditorInputMsg.fromEditorPasteWithIntent({
        ...legacy.payload,
        intent: { plainOnly },
      })
    ).slice();
    const decoded = EditorInputMsg.decode(encoded).data;
    expect(decoded.discriminator).toBe(10);
    if (decoded.discriminator !== 10) throw new Error('Expected typed paste');
    expect(decoded.value.intent.plainOnly).toBe(plainOnly);
    expect(decoded.value.selection).toEqual(legacy.payload.selection);
    expect(decoded.value.clipboard).toEqual(legacy.payload.clipboard);
    expect(decoded.value.htmlNodes).toEqual(legacy.payload.htmlNodes);
    expect(decoded.value.hasFiles).toBe(true);
  }
);
