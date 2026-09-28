/** Where a store narrates its reads and writes, when the caller wants to hear. */
export type StoreLogger = {
  debug: (message: string) => void;
};
