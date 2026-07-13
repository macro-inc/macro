import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

type EmojiUsage = Record<string, { count: number; lastUsed: number }>;

const MAX_TRACKED_EMOJIS = 100;

const [usage, setUsage] = makePersisted(createSignal<EmojiUsage>({}), {
  name: 'emojiUsage',
});

export function recordEmojiUsage(emoji: string): void {
  setUsage((current) => {
    const next: EmojiUsage = {
      ...current,
      [emoji]: {
        count: (current[emoji]?.count ?? 0) + 1,
        lastUsed: Date.now(),
      },
    };
    const keys = Object.keys(next);
    if (keys.length > MAX_TRACKED_EMOJIS) {
      const dropped = keys
        .sort(
          (a, b) =>
            next[a].count - next[b].count || next[a].lastUsed - next[b].lastUsed
        )
        .slice(0, keys.length - MAX_TRACKED_EMOJIS);
      for (const key of dropped) {
        delete next[key];
      }
    }
    return next;
  });
}

export function emojiUsageCount(emoji: string): number {
  return usage()[emoji]?.count ?? 0;
}

export function frequentEmojiChars(limit: number): string[] {
  return Object.entries(usage())
    .sort(([, a], [, b]) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map(([emoji]) => emoji);
}

export function clearEmojiUsage(): void {
  setUsage({});
}
