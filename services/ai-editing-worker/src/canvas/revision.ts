import type { CanvasSnapshot } from './render';

/** Object insertion order differs between replicas; revision identity must not. */
export function canonicalCanvasJson(value: unknown): string {
  return JSON.stringify(value, (_, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))
        )
      : entry
  );
}

export async function canvasRevision(
  snapshot: CanvasSnapshot
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      canonicalCanvasJson({
        document: snapshot.document,
        clock: snapshot.clock,
      })
    )
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0')
  ).join('');
}
