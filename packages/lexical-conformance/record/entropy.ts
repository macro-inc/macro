import type { Op, Value } from './schema';

/** No ambient entropy is permitted. Every read must have an installed tape. */
export class Entropy {
  private restore: (() => void)[] = [];
  private state = 1;
  private clock = 1730900000000;
  private active = false;
  constructor(
    private emit?: (op: Op) => void,
    private replay?: Op[],
    private capture = () => true
  ) {}

  private read(src: string, generate: () => Value, outside = generate): Value {
    if (!this.active || !this.capture()) return outside();
    if (this.replay) {
      const event = this.replay.shift();
      if (!event || event.src !== src)
        throw new Error(`untaped-entropy: ${src}`);
      return event.op === 'clock' ? event.t : event.v;
    }
    if (!this.emit) throw new Error(`untaped-entropy: ${src}`);
    const value = generate();
    this.emit(
      src === 'date' || src === 'perf'
        ? { op: 'clock', src, t: value }
        : { op: 'entropy', src, v: value }
    );
    return value;
  }

  install(): void {
    this.active = true;
    const patch = (target: object, key: string, value: unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value,
      });
      this.restore.push(() => {
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      });
    };
    const random = () => {
      this.state = (Math.imul(this.state, 1664525) + 1013904223) | 0;
      return (this.state >>> 0) / 4294967296;
    };
    const nativeDate = Date.now.bind(Date);
    const nativePerf = performance.now.bind(performance);
    const nativeRandom = Math.random.bind(Math);
    const nativeUUID = crypto.randomUUID.bind(crypto);
    const nativeValues = crypto.getRandomValues.bind(crypto);
    patch(Date, 'now', () => this.read('date', () => this.clock++, nativeDate));
    patch(performance, 'now', () =>
      this.read('perf', () => this.clock++ - 1730900000000, nativePerf)
    );
    patch(Math, 'random', () => this.read('random', random, nativeRandom));
    patch(crypto, 'randomUUID', () =>
      this.read(
        'uuid',
        () => {
          const bytes = Array.from({ length: 16 }, () =>
            Math.floor(random() * 256)
          );
          bytes[6] = (bytes[6] & 15) | 64;
          bytes[8] = (bytes[8] & 63) | 128;
          const hex = bytes
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        },
        nativeUUID
      )
    );
    patch(crypto, 'getRandomValues', (array: ArrayBufferView) => {
      if (!this.active || !this.capture())
        return Reflect.apply(nativeValues, crypto, [array]);
      if (
        array instanceof Float32Array ||
        array instanceof Float64Array ||
        array.byteLength > 65536
      ) {
        throw new TypeError('Invalid getRandomValues input');
      }
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength
      );
      const result = this.read('getRandomValues', () =>
        Array.from(bytes, () => Math.floor(random() * 256))
      );
      if (!Array.isArray(result) || result.length !== bytes.length)
        throw new Error('entropy-length');
      bytes.set(result.map(Number));
      return array;
    });
  }

  dispose(validate = true): void {
    this.active = false;
    for (const restore of this.restore.reverse()) restore();
    this.restore = [];
    if (validate && this.replay?.length) throw new Error('unconsumed-entropy');
  }
}
