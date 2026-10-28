import { Sha256 } from '@aws-crypto/sha256-js';
import { ArchiveError } from '../../../features/slack-import/core/export';
import type {
  ConversationSeal,
  PartDescriptor,
  PartLimits,
} from '../../../features/slack-import/core/worker-protocol';
import { MAX_RECORD_BYTES, type StoredMessage } from './message-store';

export const DEFAULT_PART_LIMITS: Readonly<PartLimits> = {
  partBytes: 16 * 1024 * 1024,
  partRecords: 20_000,
  recordBytes: MAX_RECORD_BYTES,
};

export type NdjsonOutput =
  | { type: 'part'; descriptor: PartDescriptor; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'seal'; seal: ConversationSeal };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function validateLimits(limits: PartLimits): void {
  for (const key of ['partBytes', 'partRecords', 'recordBytes'] as const) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] <= 0 ||
      limits[key] > DEFAULT_PART_LIMITS[key]
    )
      throw new ArchiveError('invalid_metadata');
  }
}

/** One bounded part plus the cursor's bounded page, never an array of parts/descriptors.
 * Resuming the iterator is the consumer's acknowledgement; no prefetch runs during yield.
 * The incremental manifest hash follows ConversationSeal::from_descriptors in Rust.
 */
export async function* ndjsonParts(
  slackChannelId: string,
  messages: AsyncIterable<StoredMessage>,
  limits: PartLimits = DEFAULT_PART_LIMITS,
  signal?: AbortSignal
): AsyncGenerator<NdjsonOutput> {
  validateLimits(limits);
  const encoder = new TextEncoder();
  const manifest = new Sha256();
  let buffer = new Uint8Array(0);
  let length = 0;
  let count = 0;
  let partIndex = 0;

  async function finishPart(): Promise<
    Extract<NdjsonOutput, { type: 'part' }>
  > {
    const bytes = buffer.slice(0, length);
    const sha256 = hex(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    );
    if (signal?.aborted) throw new ArchiveError('cancelled');
    const descriptor: PartDescriptor = {
      upload: { kind: 'conversation_part', slackChannelId, partIndex },
      sha256,
      byteLength: length,
      recordCount: count,
    };
    manifest.update(`${partIndex}:${sha256}:${length}:${count}\n`);
    partIndex++;
    length = 0;
    count = 0;
    return { type: 'part', descriptor, bytes };
  }

  for await (const message of messages) {
    if (signal?.aborted) throw new ArchiveError('cancelled');
    const bytes = encoder.encode(message.line);
    if (bytes.length > limits.recordBytes || bytes.length > limits.partBytes)
      throw new ArchiveError('record_limit');
    if (
      count &&
      (count === limits.partRecords || length + bytes.length > limits.partBytes)
    ) {
      yield await finishPart();
      if (signal?.aborted) throw new ArchiveError('cancelled');
    }
    if (!buffer.length) buffer = new Uint8Array(limits.partBytes);
    buffer.set(bytes, length);
    length += bytes.length;
    count++;
  }
  if (signal?.aborted) throw new ArchiveError('cancelled');
  if (count) yield await finishPart();
  buffer = new Uint8Array(0);
  if (signal?.aborted) throw new ArchiveError('cancelled');
  yield {
    type: 'seal',
    seal: {
      slackChannelId,
      partCount: partIndex,
      manifestSha256: hex(manifest.digestSync()),
    },
  };
}
