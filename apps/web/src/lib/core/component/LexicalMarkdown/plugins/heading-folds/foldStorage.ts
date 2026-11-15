/**
 * @file Where folded headings are remembered: per person and per device, in
 * one localStorage entry mapping each document to the node ids of its folded
 * headings. Folding is a reading preference, so it never enters the document
 * or reaches collaborators.
 */
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { z } from 'zod';

const STORAGE = createUserScopedStorage('macro:md-heading-folds');

/** Documents remembered per person; the least recently folded drop first. */
const MAX_DOCUMENTS = 200;

const FOLDS_SCHEMA = z.record(
  z.string(),
  z.object({ ids: z.array(z.string()), at: z.number() })
);

type Folds = z.infer<typeof FOLDS_SCHEMA>;

function readAll(userId: string): Folds {
  const raw = STORAGE.read(userId);
  if (!raw) return {};
  try {
    const parsed = FOLDS_SCHEMA.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readFoldedIds(userId: string, documentId: string): string[] {
  return readAll(userId)[documentId]?.ids ?? [];
}

export function writeFoldedIds(
  userId: string,
  documentId: string,
  ids: string[],
  now = Date.now()
) {
  const folds = readAll(userId);
  if (ids.length > 0) folds[documentId] = { ids, at: now };
  else delete folds[documentId];

  const kept = Object.entries(folds)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DOCUMENTS);
  STORAGE.write(userId, JSON.stringify(Object.fromEntries(kept)));
}
