import { type Accessor, createMemo, createSignal } from 'solid-js';

/** Keep metadata for explicit picker choices without retaining suggestion
 * history or treating that metadata as proof for inferred names. */
export function createRecipientSelection<T>(
  value: Accessor<string>,
  resolve: (text: string) => T[],
  serialize: (items: T[]) => string,
  write: (text: string) => void
) {
  const text = createMemo(value);
  const input = createMemo(() => ({ text: text() }));
  const resolved = createMemo(() => resolve(text()));
  const [choice, setChoice] = createSignal<{
    input: ReturnType<typeof input>;
    items: T[];
  }>();
  return {
    selected: () => {
      const current = choice();
      return current?.input === input() ? current.items : resolved();
    },
    select: (items: T[]) => {
      const text = serialize(items);
      write(text);
      if (value() === text) setChoice({ input: input(), items });
    },
  };
}
