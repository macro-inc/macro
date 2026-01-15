import {
  createContextProvider,
  type ContextProvider,
  type ContextProviderProps,
} from '@solid-primitives/context';

/**
 * Creates a context provider that throws if used outside of provider tree.
 * Thin wrapper around solid-primitives createContextProvider.
 *
 * @param name - Name of the context (used in error messages)
 * @param factory - Factory function that creates the context value
 * @returns Tuple of [Provider, useContext] where useContext throws if undefined
 */
export function createAssertedContextProvider<T>(
  name: string,
  factory: () => T
): [provider: ContextProvider<ContextProviderProps>, useContext: () => T] {
  const [Provider, useContext] = createContextProvider(factory);

  const useAssertedContext = (): T => {
    const ctx = useContext();
    if (ctx === undefined) {
      throw new Error(`${name} must be used within <${name}Provider />`);
    }
    return ctx;
  };

  return [Provider, useAssertedContext];
}
