export type WithRequired<T, K extends keyof T> = T & {
  [P in K]-?: NonNullable<T[P]>;
};

export type DeepPartial<T> =
  // Preserve function types
  T extends (...args: any[]) => any
    ? T
    : T extends object
      ? { [P in keyof T]?: DeepPartial<T[P]> }
      : T;
