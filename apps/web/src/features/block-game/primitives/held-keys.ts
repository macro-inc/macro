/**
 * Keys held on a focused board, for games that steer continuously. Keys are
 * compared lowercased, so `w` and `W` count the same.
 */
export function createHeldKeys() {
  const held = new Set<string>();
  return {
    press: (key: string) => held.add(key.toLowerCase()),
    release: (key: string) => held.delete(key.toLowerCase()),
    /** Focus left the board; nothing stays held. */
    clear: () => held.clear(),
    /** -1 while a negative key is held, 1 for a positive one, else 0. */
    axis: (negative: readonly string[], positive: readonly string[]) => {
      const down = (keys: readonly string[]) =>
        keys.some((key) => held.has(key.toLowerCase()));
      return (down(positive) ? 1 : 0) - (down(negative) ? 1 : 0);
    },
  };
}

export type HeldKeys = ReturnType<typeof createHeldKeys>;

/** Arrow keys and WASD, for vertical and horizontal steering. */
export const UP_KEYS = ['ArrowUp', 'w'] as const;
export const DOWN_KEYS = ['ArrowDown', 's'] as const;
export const LEFT_KEYS = ['ArrowLeft', 'a'] as const;
export const RIGHT_KEYS = ['ArrowRight', 'd'] as const;
