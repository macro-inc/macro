/** Flattens merged object types
 * @example
 * Flatten<{ x: string } & { y: string }> = { x: string; y: string }
 **/
export type FlattenObject<T> = T extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

/** Flattens the array type to extract the inner type, otherwise returns the type itself
 * @example
 * FlattenArray<string[]> = string
 * FlattenArray<string> = string
 **/
export type FlattenArray<Type> = Type extends Array<infer Item> ? Item : Type;
