import type { EditorConfig, Klass, LexicalEditor, LexicalNode } from 'lexical';

export type DOMFactory<T extends LexicalNode> = (
  node: T,
  config: EditorConfig,
  editor: LexicalEditor
) => HTMLElement;

// Registry to store DOM factories for specific node types
const domFactoryRegistry = new Map<Klass<LexicalNode>, DOMFactory<any>>();

/**
 * Register a custom DOM factory for a specific node class.
 * @param klass - The node class to register a factory for
 * @param factory - Function that creates the DOM element for the node
 *
 * @example
 * ```typescript
 * setDOMFactory(DiffNode, (node, config, editor) => {
 *   const container = document.createElement('div');
 *   container.className = 'custom-diff-styles';
 *
 *   render(() => <CustomDiffUI node={node} />, container);
 *
 *   return container;
 * });
 * ```
 */
export function setDOMFactory<T extends LexicalNode>(
  klass: Klass<T>,
  factory: DOMFactory<T>
): void {
  domFactoryRegistry.set(klass, factory);
}

/**
 * Get the registered DOM factory for a node class.
 * @param klass - The node class to get the factory for
 * @returns The registered DOM factory, or undefined if none exists
 */
export function getDOMFactory<T extends LexicalNode>(
  klass: Klass<T>
): DOMFactory<T> | undefined {
  return domFactoryRegistry.get(klass);
}

/**
 * Check if a DOM factory is registered for a node class.
 * @param klass - The node class to check
 * @returns True if a factory is registered, false otherwise
 */
export function hasDOMFactory<T extends LexicalNode>(klass: Klass<T>): boolean {
  return domFactoryRegistry.has(klass);
}

/**
 * Remove a registered DOM factory for a node class.
 * @param klass - The node class to remove the factory for
 * @returns True if a factory was removed, false if none was registered
 */
export function removeDOMFactory<T extends LexicalNode>(
  klass: Klass<T>
): boolean {
  return domFactoryRegistry.delete(klass);
}

/**
 * Clear all registered DOM factories.
 * Useful for testing or when reinitializing the editor.
 */
export function clearDOMFactories(): void {
  domFactoryRegistry.clear();
}

export function createDOMWithFactory<T extends LexicalNode>(
  node: T,
  config: EditorConfig,
  editor: LexicalEditor,
  fallback: () => HTMLElement
): HTMLElement {
  const factory = getDOMFactory(node.constructor as Klass<T>);
  if (factory) {
    return factory(node, config, editor);
  }
  return fallback();
}
