import { ForeignCallbackValue } from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { encodeValue, fromUtf16, safeNumber, utf16 } from './values';

test('scalar wire preserves UTF16 code units and nonfinite numeric values', () => {
  const text = `astral:😀 lone:${String.fromCharCode(0xd800)} nul:${String.fromCharCode(0)}`;
  const encoded = ForeignCallbackValue.encode(
    encodeValue(text, () => {
      throw new Error('Scalar encoding must not resolve a node');
    })
  );
  const decoded = ForeignCallbackValue.decode(encoded).data;
  if (decoded.discriminator !== 10) throw new Error('Expected string value');
  expect(fromUtf16(decoded.value.value)).toBe(text);
  expect(fromUtf16(utf16(text.repeat(1000)))).toBe(text.repeat(1000));
  for (const value of [-0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const decoded = ForeignCallbackValue.decode(
      ForeignCallbackValue.encode(
        encodeValue(value, () => {
          throw new Error('Scalar encoding must not resolve a node');
        })
      )
    ).data;
    if (decoded.discriminator !== 9) throw new Error('Expected number value');
    expect(Object.is(decoded.value.value, value)).toBe(true);
  }
});

test('native handle conversion rejects unsafe integers and does not serialize objects', () => {
  expect(safeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
    Number.MAX_SAFE_INTEGER
  );
  expect(() => safeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
    'Native identity exceeds the JS handle range'
  );
  let serialized = false;
  const object = {
    toJSON() {
      serialized = true;
      return 'wrong';
    },
  };
  expect(() =>
    encodeValue(object, () => {
      throw new Error('Ordinary objects are not node handles');
    })
  ).toThrow('Unsupported native compatibility argument');
  expect(serialized).toBe(false);
});
