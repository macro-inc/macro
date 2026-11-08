import type { Component, Accessor } from 'solid-js';
import type { EditorView } from './editor-view';
import type { JsonObject, ViewNode, TypeFlags } from './types';

export interface ElementDOMSlot {
  readonly element: HTMLElement;
  readonly after?: Node | null;
  readonly before?: Node | null;
}
export interface EditorThemeClasses {
  readonly [name: string]:
    | string
    | EditorThemeClasses
    | readonly string[]
    | undefined;
}
export function themeClass(
  theme: EditorThemeClasses,
  ...path: readonly string[]
): string {
  let value: unknown = theme;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return '';
    value = Reflect.get(value, key);
  }
  return typeof value === 'string' ? value : '';
}
export interface RenderContext {
  readonly document: Document;
  readonly namespace: string;
  readonly theme: EditorThemeClasses;
  readonly view: EditorView;
}
export interface DecoratorProps {
  readonly node: Accessor<ViewNode>;
  readonly view: EditorView;
}
export interface DraftConversion {
  readonly priority: 0 | 1 | 2 | 3 | 4;
  readonly convert: (
    element: HTMLElement,
    children: readonly JsonObject[]
  ) => readonly JsonObject[] | null;
}
export type DraftConversionMap = Readonly<
  Record<string, (element: HTMLElement) => DraftConversion | null>
>;
export interface NodeView {
  flags?(node: ViewNode): TypeFlags;
  createDOM(node: ViewNode, context: RenderContext): HTMLElement;
  updateDOM(
    previous: ViewNode,
    next: ViewNode,
    dom: HTMLElement,
    context: RenderContext
  ): boolean;
  getDOMSlot?(node: ViewNode, dom: HTMLElement): ElementDOMSlot;
  readonly decorator?: Component<DecoratorProps>;
  readonly importDOM?: DraftConversionMap;
}
export class NodeViewRegistry {
  private readonly entries = new Map<string, NodeView>();
  register(name: string, view: NodeView): this {
    if (this.entries.has(name)) throw new Error('Duplicate node view: ' + name);
    this.entries.set(name, view);
    return this;
  }
  replace(name: string, view: NodeView): this {
    this.get(name);
    this.entries.set(name, view);
    return this;
  }
  get(name: string): NodeView {
    const view = this.entries.get(name);
    if (!view) throw new Error('Missing node view: ' + name);
    return view;
  }
  importers(
    tag: string
  ): readonly ((element: HTMLElement) => DraftConversion | null)[] {
    const importers: ((element: HTMLElement) => DraftConversion | null)[] = [];
    for (const view of this.entries.values()) {
      const importer = view.importDOM?.[tag];
      if (importer) importers.push(importer);
    }
    return importers;
  }
  has(name: string): boolean {
    return this.entries.has(name);
  }
}
