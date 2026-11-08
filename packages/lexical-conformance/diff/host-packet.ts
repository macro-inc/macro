import type { HostCommitPacket } from './host-packet.generated';

/** Strict consumer of the generated development packet, independent of Rust. */
export function decodeHostPacket(bytes: Uint8Array): HostCommitPacket {
  let position = 0;
  const word = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = bytes[position++];
      if (byte === undefined || (shift === 28 && byte > 15)) {
        throw new Error('invalid postcard u32');
      }
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) return value;
    }
    throw new Error('invalid postcard u32');
  };
  const data = () => {
    const length = word();
    if (length > bytes.length - position)
      throw new Error('truncated postcard data');
    const value = bytes.subarray(position, position + length);
    position += length;
    return value;
  };
  const format_version = word();
  if (format_version !== 2) throw new Error('unsupported host packet version');
  const count = word();
  if (count > bytes.length - position)
    throw new Error('truncated postcard words');
  const words = [];
  for (let index = 0; index < count; index++) words.push(word());
  const strings = Array.from(data());
  const metadata_json = new TextDecoder('utf-8', { fatal: true }).decode(
    data()
  );
  const flag = bytes[position++];
  if (flag !== 0 && flag !== 1) throw new Error('invalid postcard bool');
  const changed = flag === 1;
  if (position !== bytes.length) throw new Error('trailing postcard bytes');
  return { format_version, words, strings, metadata_json, changed };
}
