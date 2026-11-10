import { run } from 'macro:client';
type ArgsOf<P extends (...args: never[]) => unknown> = Parameters<P> extends []
  ? []
  : {} extends Parameters<P>[0]
    ? [args?: Parameters<P>[0]]
    : [args: Parameters<P>[0]];
// A value as JSON.stringify leaves it: `toJSON` applied (a Date is a string,
// a handle its `toJSON()`), functions dropped.
type Json<T> = T extends { toJSON(...args: never[]): infer R }
  ? Json<R>
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends (...args: never[]) => unknown
      ? never
      : T extends readonly unknown[]
        ? { [I in keyof T]: Json<T[I]> }
        : T extends object
          ? { [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: Json<T[K]> }
          : never;
// What the page receives: a program that returns nothing resolves to null.
type Returned<T> = 0 extends 1 & T
  ? T
  : [T] extends [void]
    ? null
    : Json<Exclude<T, undefined | void>> | (undefined extends T ? null : never);
