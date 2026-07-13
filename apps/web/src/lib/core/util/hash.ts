export async function contentHash(buffer: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest({ name: 'SHA-256' }, buffer);
  const hashHex = toHex(new Uint8Array(hashBuffer));
  return hashHex;
}

// Fastest way to convert uint8array to hex: https://www.xaymar.com/articles/2020/12/08/fastest-uint8array-to-hex-string-conversion-in-javascript/
const LUT_HEX_4b = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
];
const LUT_HEX_8b = new Array(0x100);
for (let n = 0; n < 0x100; n++) {
  LUT_HEX_8b[n] = `${LUT_HEX_4b[(n >>> 4) & 0xf]}${LUT_HEX_4b[n & 0xf]}`;
}

// End Pre-Init
export function toHex(buffer: Uint8Array): string {
  let out = '';
  for (let idx = 0, edx = buffer.length; idx < edx; idx++) {
    out += LUT_HEX_8b[buffer[idx]];
  }
  return out;
}
