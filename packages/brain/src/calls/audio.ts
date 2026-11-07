export type Pcm = {
  rate: number;
  samples: Int16Array;
};
export function parseWav(bytes: Uint8Array): Pcm {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF')
    throw new Error('not a WAV file');
  let off = 12;
  let rate = 0;
  let channels = 1;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(off, off + 4));
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true);
      rate = dv.getUint32(off + 12, true);
      if (dv.getUint16(off + 22, true) !== 16)
        throw new Error('only 16-bit WAV');
    }
    if (id === 'data') {
      const end =
        size && off + 8 + size <= bytes.length ? off + 8 + size : bytes.length;
      const data = bytes.slice(off + 8, end - ((end - off - 8) % 2));
      let samples = new Int16Array(data.buffer);
      if (channels > 1) samples = samples.filter((_, i) => i % channels === 0);
      return { rate, samples };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
export function wavHeader(
  rate: number,
  dataBytes: number
): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(44);
  const dv = new DataView(h.buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, dataBytes, true);
  return h;
}
export function encodeWav({ rate, samples }: Pcm): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.byteLength);
  out.set(wavHeader(rate, samples.byteLength));
  out.set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    44
  );
  return out;
}
export type Level = {
  peak: number;
  rms: number;
  dbfs: number;
};
export function level(s: Int16Array): Level {
  let peak = 0;
  let sum = 0;
  for (const v of s) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = s.length ? Math.sqrt(sum / s.length) : 0;
  return {
    peak,
    rms: Math.round(rms),
    dbfs: rms > 0 ? Math.round(20 * Math.log10(rms / 32768)) : -120,
  };
}
export function resample(s: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return s;
  const n = Math.floor((s.length * to) / from);
  const out = new Int16Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = s[j] ?? 0;
    const b = s[j + 1] ?? a;
    out[i] = Math.round(a + (b - a) * (x - j));
  }
  return out;
}
export function* frames(s: Int16Array, size: number): Generator<Int16Array> {
  for (let i = 0; i < s.length; i += size) {
    const f = s.subarray(i, i + size);
    if (f.length === size) yield f;
    else {
      const pad = new Int16Array(size);
      pad.set(f);
      yield pad;
    }
  }
}
export class Gain {
  static readonly TARGET_RMS = 3000;
  static readonly MAX = 16;
  static readonly SPEECH_RMS = 40;
  gain = 1;
  apply(frame: Int16Array): Int16Array {
    const { rms } = level(frame);
    if (rms >= Gain.SPEECH_RMS) {
      const want = Math.min(Gain.MAX, Math.max(1, Gain.TARGET_RMS / rms));
      this.gain += (want - this.gain) * (want < this.gain ? 0.5 : 0.1);
    }
    if (this.gain === 1) return frame;
    const out = new Int16Array(frame.length);
    for (let i = 0; i < frame.length; i++)
      out[i] = Math.max(
        -32768,
        Math.min(32767, Math.round(frame[i]! * this.gain))
      );
    return out;
  }
}
