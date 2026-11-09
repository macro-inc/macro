import {
  ForeignCallbackValue,
  ForeignOpaqueValue,
  type IForeignKey,
  type IForeignRecordRef,
} from '@macro-inc/collaboration/session/compatibility.generated';

export function utf16(value: string): number[] {
  const units: number[] = [];
  for (let at = 0; at < value.length; at++) units.push(value.charCodeAt(at));
  return units;
}
export function fromUtf16(units: readonly number[]): string {
  let result = '';
  for (let at = 0; at < units.length; at += 8192) {
    result += String.fromCharCode(...units.slice(at, at + 8192));
  }
  return result;
}
export function publicKey(key: IForeignKey): string {
  return key.index === 0 ? 'root' : String(key.index);
}
export function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error('Native identity exceeds the JS handle range');
  return result;
}
export function absent(): ForeignCallbackValue {
  return ForeignCallbackValue.fromForeignOpaqueArgument({
    value: ForeignOpaqueValue.fromForeignUndefined({}),
  });
}
export function encodeValue(
  value: unknown,
  reference: (handle: number) => IForeignRecordRef
): ForeignCallbackValue {
  if (value === null)
    return ForeignCallbackValue.fromForeignOpaqueArgument({
      value: ForeignOpaqueValue.fromForeignNull({}),
    });
  if (value === undefined) return absent();
  if (typeof value === 'boolean')
    return ForeignCallbackValue.fromForeignBooleanArgument({ value });
  if (typeof value === 'number')
    return ForeignCallbackValue.fromForeignNumberArgument({ value });
  if (typeof value === 'string')
    return ForeignCallbackValue.fromForeignStringArgument({
      value: utf16(value),
    });
  if (typeof value === 'object' && '$undef' in value) return absent();
  if (
    typeof value === 'object' &&
    '$h' in value &&
    typeof value.$h === 'number'
  ) {
    return ForeignCallbackValue.fromForeignRecordArgument({
      value: reference(value.$h),
    });
  }
  throw new TypeError('Unsupported native compatibility argument');
}
