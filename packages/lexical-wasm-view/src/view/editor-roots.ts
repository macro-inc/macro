interface ExternalEditorRoot {
  readonly editor: object;
}

const externalRoots = new WeakMap<Node, ExternalEditorRoot>();

/** Register an actual editor's DOM root from its root-listener lifecycle. */
export function registerExternalEditorRoot(
  root: HTMLElement,
  editor: object
): () => void {
  const entry = { editor };
  externalRoots.set(root, entry);
  return () => {
    if (externalRoots.get(root) === entry) externalRoots.delete(root);
  };
}

export function externalEditorRootOwner(root: Node): object | undefined {
  return externalRoots.get(root)?.editor;
}
