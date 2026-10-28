/** Max bytes of message payload per frame. Mirrors the Rust `MAX_CHUNK_SIZE`. */
export const MAX_CHUNK_SIZE = 900_000;

/**
 * Splits a serialized message into wire frames of `[isFinal: u8, ...chunk]`.
 */
export function intoFrames(
  payload: Uint8Array,
  maxChunk = MAX_CHUNK_SIZE
): Uint8Array[] {
  const frames: Uint8Array[] = [];
  // Always emit at least one frame, even for an empty payload.
  for (
    let offset = 0;
    offset < payload.length || frames.length === 0;
    offset += maxChunk
  ) {
    const chunk = payload.subarray(offset, offset + maxChunk);
    const isFinal = offset + maxChunk >= payload.length;
    const frame = new Uint8Array(1 + chunk.length);
    frame[0] = isFinal ? 1 : 0;
    frame.set(chunk, 1);
    frames.push(frame);
  }
  return frames;
}

/**
 * Reassembles frames produced by {@link intoFrames} back into whole messages.
 * One instance per connection; frames arrive in order over a single socket.
 */
export class Reassembler {
  private chunks: Uint8Array[] = [];

  /**
   * Feeds one frame. Returns the complete message once the final frame arrives,
   * otherwise `null` (more frames pending).
   */
  push(frame: Uint8Array): Uint8Array | null {
    const isFinal = frame[0] === 1;
    this.chunks.push(frame.subarray(1));
    if (!isFinal) return null;

    const message = concat(this.chunks);
    this.chunks = [];
    return message;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
