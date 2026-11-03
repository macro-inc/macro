/**
 * The dynamic-UI view, as `crates/dynamic_ui` defines it. The server decodes
 * every view before the browser sees it, so the renderer takes the view as it
 * is serialized. Run `just gen-dynamic-ui-types` after changing a widget.
 */

import type {
  EntityRef,
  Query_Serialize,
  View_Serialize,
  Widget_Serialize,
} from './generated/types';

export type { EntityRef };
export type Query = Query_Serialize;
export type View = View_Serialize;
export type Widget = Widget_Serialize;

export type WidgetType = Widget['type'];

/** Narrow a `Widget` to a specific variant by its `type`. */
export type WidgetOf<T extends WidgetType> = Extract<Widget, { type: T }>;
