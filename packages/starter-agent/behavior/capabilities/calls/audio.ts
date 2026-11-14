/** PCM helpers for the recordings and the verification tools: WAV read and write, levels. 16-bit mono only. */

export type Pcm = { readonly rate: number; readonly samples: Int16Array };

const headerBytes = 44;
const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(from, from + length));

export const parseWav = (bytes: Uint8Array): Pcm => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF') throw new Error('not a WAV file');
  let offset = 12;
  let rate = 0;
  let channels = 1;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      rate = view.getUint32(offset + 12, true);
      if (view.getUint16(offset + 22, true) !== 16)
        throw new Error('only 16-bit WAV');
    }
    if (id === 'data') {
      // A WAV cut off mid-call has size 0 or too big in its header: take what's there.
      const end =
        size !== 0 && offset + 8 + size <= bytes.length
          ? offset + 8 + size
          : bytes.length;
      const data = bytes.slice(offset + 8, end - ((end - offset - 8) % 2));
      const all = new Int16Array(data.buffer);
      return {
        rate,
        samples: channels > 1 ? all.filter((_, i) => i % channels === 0) : all,
      };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
};

export const wavHeader = (rate: number, dataBytes: number): Uint8Array => {
  const header = new Uint8Array(headerBytes);
  const view = new DataView(header.buffer);
  const text = (offset: number, value: string) =>
    header.set(
      [...value].map((character) => character.charCodeAt(0)),
      offset
    );
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
};

/** Where a WAV's samples start. */
export const wavDataOffset = headerBytes;

export const encodeWav = ({ rate, samples }: Pcm): Uint8Array => {
  const out = new Uint8Array(headerBytes + samples.byteLength);
  out.set(wavHeader(rate, samples.byteLength));
  out.set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    headerBytes
  );
  return out;
};

export type Level = {
  readonly peak: number;
  readonly rms: number;
  readonly dbfs: number;
};

export const level = (samples: Int16Array): Level => {
  let peak = 0;
  let sum = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sum += sample * sample;
  }
  const rms = samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
  return {
    peak,
    rms: Math.round(rms),
    dbfs: rms > 0 ? Math.round(20 * Math.log10(rms / 32768)) : -120,
  };
};

/** The samples in frames of `size`, the last one padded with silence. */
export function* frames(
  samples: Int16Array,
  size: number
): Generator<Int16Array> {
  for (let i = 0; i < samples.length; i += size) {
    const frame = samples.subarray(i, i + size);
    if (frame.length === size) yield frame;
    else {
      const padded = new Int16Array(size);
      padded.set(frame);
      yield padded;
    }
  }
}
