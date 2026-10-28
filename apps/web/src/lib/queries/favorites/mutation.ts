/** Favorites callbacks shared by REST and GraphQL, without transport internals. */
export type FavoriteMutationCallbacks<Data, Input, Context = void> = {
  onMutate?: (
    input: Input
  ) => Context | undefined | Promise<Context | undefined>;
  onSuccess?: (
    data: Data,
    input: Input,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: Input,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    data: Data | undefined,
    error: Error | null,
    input: Input,
    context: Context | undefined
  ) => void | Promise<void>;
};
