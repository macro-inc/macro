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
