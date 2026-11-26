import { hireIntent, returnPath } from './return-intent';

export type Draft = {
  first: string;
  last: string;
  portrait: number;
  width: number;
};
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = 'macro.bots.hire';
const lifetime = 10 * 60 * 1000;

export function storeHireDraft(
  storage: DraftStorage,
  draft: Draft,
  now = Date.now()
): string {
  const handoff = crypto.randomUUID();
  storage.setItem(
    key,
    JSON.stringify({ handoff, draft, expiresAt: now + lifetime })
  );
  return handoff;
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  return (
    'first' in value &&
    typeof value.first === 'string' &&
    value.first.length <= 40 &&
    'last' in value &&
    typeof value.last === 'string' &&
    value.last.length <= 40 &&
    'portrait' in value &&
    typeof value.portrait === 'number' &&
    Number.isInteger(value.portrait) &&
    value.portrait >= 0 &&
    'width' in value &&
    typeof value.width === 'number' &&
    Number.isInteger(value.width) &&
    Math.abs(value.width) <= 20
  );
}

export function takeHireDraft(
  storage: DraftStorage,
  handoff: string,
  now = Date.now()
): Draft | undefined {
  const stored = storage.getItem(key);
  if (!stored) return undefined;

  try {
    const value: unknown = JSON.parse(stored);
    if (
      !value ||
      typeof value !== 'object' ||
      !('handoff' in value) ||
      value.handoff !== handoff
    ) {
      return undefined;
    }

    storage.removeItem(key);
    if (
      'expiresAt' in value &&
      typeof value.expiresAt === 'number' &&
      value.expiresAt > now &&
      'draft' in value &&
      isDraft(value.draft)
    ) {
      return value.draft;
    }
  } catch {
    storage.removeItem(key);
  }
}

export function hireReturnUrl(handoff: string): string {
  return `${returnPath(hireIntent)}&${new URLSearchParams({ handoff })}`;
}
