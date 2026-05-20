export type WithRequired<T, K extends keyof T> = T & {
  [P in K]-?: NonNullable<T[P]>;
};

export type NonNullableFields<T> = {
  [K in keyof T]: NonNullable<T[K]>;
};
