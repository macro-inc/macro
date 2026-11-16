/**
 * The agent's credentials: one interface, whatever keeps them. A value is handed
 * to the code that needs it and goes no further: never printed, logged, or
 * written anywhere but back through `set`.
 */
export type Credentials = {
  /** The credential by this name. Throws if there is none, or it is empty. */
  readonly get: (name: string) => Promise<string>;
  /** Whether there is a credential by this name. */
  readonly has: (name: string) => Promise<boolean>;
  /** Adds a credential, or replaces the one by this name. */
  readonly set: (name: string, value: string) => Promise<void>;
  /** Every credential's name, sorted. Names aren't secret. */
  readonly names: () => Promise<readonly string[]>;
};

/** Credentials kept in memory, e.g. for tests. */
export const memoryCredentials = (
  initial: Readonly<Record<string, string>> = {}
): Credentials => {
  const values = new Map(Object.entries(initial));
  return {
    get: async (name) => {
      const value = values.get(name);
      if (value === undefined || value === '')
        throw new Error(`no credential named ${name}`);
      return value;
    },
    has: async (name) => (values.get(name) ?? '') !== '',
    set: async (name, value) => {
      values.set(name, value);
    },
    names: async () => [...values.keys()].sort(),
  };
};
