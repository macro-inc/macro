import type { EditorView as MountedEditorView } from './view/editor-view';

export {
  type LocalSessionOptions,
  mountLocalSessionView,
} from './local-session-view';
export { mountSessionView } from './session-view';
export * from './view/commands';
export {
  DRAG_END_COMMAND,
  DRAG_OVER_COMMAND,
  DRAG_START_COMMAND,
  INTERNAL_DROP_COMMAND,
  type InternalDrop,
} from './view/drag';
export {
  type CommitInfo,
  EditorView,
  type ViewOptions,
} from './view/editor-view';
export type { NativeEnterModule, NativeEnterScope } from './view/native-enter';
export type { NativeCallbackFailure } from './view/native-enter-output';
export { createBuiltinRegistry } from './view/node-views/builtins';
export {
  type MacroDecorators,
  type MacroDecoratorType,
  macroDecoratorTypes,
  registerMacroDecoratorViews,
  registerMacroElementViews,
  registerMacroViews,
} from './view/node-views/macro';
export type {
  ConformancePort,
  EditorPort,
  NativeEnterPort,
  TextFromView,
  ViewSink,
} from './view/port';
export {
  type DecoratorProps,
  type EditorThemeClasses,
  type ElementDOMSlot,
  type NodeView,
  NodeViewRegistry,
  type RenderContext,
} from './view/registry';
export { createDOMRange, createRectsFromDOMRange } from './view/selection';
export { SessionPort } from './view/session-port';
export {
  getDOMCellFromTarget,
  getTableElement,
  getTableObserverFromTableElement,
} from './view/table/observer';
export type * from './view/types';

export async function enableCodeHighlighting(
  view: MountedEditorView
): Promise<() => void> {
  return (await import('./view/code-highlight')).installCodeHighlighting(view);
}
