import {
  PREPARE_VERSION,
  type PreparedEmailBody,
} from '@macro-inc/email-renderer';

export const ARTIFACT_SCHEMA_VERSION = 1;

export interface Artifact {
  key: string;
  schema: number;
  version: number;
  sourceHash: string;
  policyHash: string;
  body: PreparedEmailBody;
  bytes: number;
  lastUsed: number;
}

export interface Association {
  id: string;
  threadId: string;
  mailboxId: string;
  sourceHash: string;
  keys: string[];
}

export interface ArtifactStore {
  generation(): Promise<number>;
  read(key: string): Promise<unknown>;
  /** Resolves false only when storage was invalidated after `generation`. */
  write(
    generation: number,
    artifact: Artifact,
    association: Association
  ): Promise<boolean>;
  remove(key: string): Promise<void>;
  invalidate(): Promise<void>;
  evict?(): Promise<void>;
  close(): void;
}

export function validArtifact(
  value: unknown,
  key: string,
  sourceHash: string,
  policyHash: string
): value is Artifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<Artifact>;
  const body = artifact.body;
  return (
    artifact.key === key &&
    artifact.schema === ARTIFACT_SCHEMA_VERSION &&
    artifact.version === PREPARE_VERSION &&
    artifact.sourceHash === sourceHash &&
    artifact.policyHash === policyHash &&
    !!body &&
    typeof body.html === 'string' &&
    (body.kind === 'html' || body.kind === 'text') &&
    typeof body.hasTable === 'boolean' &&
    typeof body.hasHiddenContent === 'boolean' &&
    artifact.bytes === artifactBytes(body) &&
    Number.isFinite(artifact.lastUsed)
  );
}

export function artifactBytes(body: PreparedEmailBody): number {
  return 2 * body.html.length + 1024;
}

/** Runs an adapter call so that a synchronous throw becomes a rejection. */
export async function attempt<T>(work: () => Promise<T>): Promise<T> {
  return await work();
}

/** Storage failure/latency must never gate a foreground body indefinitely. */
export async function storageDeadline<T>(
  operation: Promise<T>,
  milliseconds = 150
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), milliseconds);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
