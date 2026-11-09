let nextId = 0;

/** Allocate the same instance namespace for source and native document editors. */
export function allocateEditorNamespace(base: string): string {
  nextId++;
  return `${base}_${nextId}`;
}
