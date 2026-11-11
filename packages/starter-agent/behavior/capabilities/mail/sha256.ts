/**
 * SHA-256, in plain TypeScript. A link from a mail is kept only as a hash, and
 * the guard that reads those hashes is pure and synchronous, so it can use
 * neither a crypto module nor the asynchronous Web Crypto.
 */
const constants: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const initial: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

const blockBytes = 64;

const rotate = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

const at = (words: ArrayLike<number>, index: number): number =>
  words[index] ?? 0;

/** The message's words, padded: a 1 bit, zeros, then its length in bits. */
const padded = (bytes: Uint8Array): DataView => {
  const length = Math.ceil((bytes.length + 9) / blockBytes) * blockBytes;
  const block = new Uint8Array(length);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(length - 4, bits >>> 0);
  return view;
};

const compress = (
  state: readonly number[],
  view: DataView,
  offset: number
): readonly number[] => {
  const words = new Uint32Array(64);
  for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
    const before = at(words, i - 15);
    const recent = at(words, i - 2);
    const small = rotate(before, 7) ^ rotate(before, 18) ^ (before >>> 3);
    const large = rotate(recent, 17) ^ rotate(recent, 19) ^ (recent >>> 10);
    words[i] = (at(words, i - 16) + small + at(words, i - 7) + large) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = [
    at(state, 0),
    at(state, 1),
    at(state, 2),
    at(state, 3),
    at(state, 4),
    at(state, 5),
    at(state, 6),
    at(state, 7),
  ];
  for (let i = 0; i < 64; i++) {
    const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choice = (e & f) ^ (~e & g);
    const first = (h + sum1 + choice + at(constants, i) + at(words, i)) >>> 0;
    const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const second = (sum0 + majority) >>> 0;
    [h, g, f, e, d, c, b, a] = [
      g,
      f,
      e,
      (d + first) >>> 0,
      c,
      b,
      a,
      (first + second) >>> 0,
    ];
  }
  return [a, b, c, d, e, f, g, h].map(
    (value, i) => (value + at(state, i)) >>> 0
  );
};

/** The SHA-256 of a text's UTF-8 bytes, as lowercase hex. */
export const sha256 = (text: string): string => {
  const view = padded(new TextEncoder().encode(text));
  let state = initial;
  for (let offset = 0; offset < view.byteLength; offset += blockBytes)
    state = compress(state, view, offset);
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
};
