/** Checks if an element matches a predicate
 * if it does it returns [T] otherwise it returns [false]
 * this is a useful utility for patten matching using solid-js's `<Switch>` & `<Match>` */
export function matches<S extends T, T = unknown>(
  e: T,
  predicate: (e: T) => e is S
): S | false {
  return predicate(e) ? e : false;
}
