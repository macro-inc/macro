import type { EditorView as MountedEditorView } from './view/editor-view';
export { SessionPort } from './view/session-port';
export type {
  EditorPort,
  ConformancePort,
  ViewSink,
  TextFromView,
} from './view/port';
export type * from './view/types';
export {
  EditorView,
  type ViewOptions,
  type CommitInfo,
} from './view/editor-view';
export {
  NodeViewRegistry,
  type NodeView,
  type EditorThemeClasses,
  type ElementDOMSlot,
  type RenderContext,
  type DecoratorProps,
} from './view/registry';
export { createBuiltinRegistry } from './view/node-views/builtins';
export {
  registerMacroViews,
  macroDecoratorTypes,
  type MacroDecorators,
  type MacroDecoratorType,
} from './view/node-views/macro';
export { mountSessionView } from './session-view';
export {
  getDOMCellFromTarget,
  getTableElement,
  getTableObserverFromTableElement,
} from './view/table/observer';

export * from './view/commands';
export { createDOMRange, createRectsFromDOMRange } from './view/selection';

export {
  INTERNAL_DROP_COMMAND,
  DRAG_START_COMMAND,
  DRAG_OVER_COMMAND,
  DRAG_END_COMMAND,
  type InternalDrop,
} from './view/drag';

export async function enableCodeHighlighting(
  view: MountedEditorView
): Promise<() => void> {
  return (await import('./view/code-highlight')).installCodeHighlighting(view);
}
