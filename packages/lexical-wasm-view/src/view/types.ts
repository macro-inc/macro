/** Browser-facing records for the flat Diff ABI. No live model handles. */
export type NodeKey = number;
export type NodeKind = 'root' | 'element' | 'text' | 'decorator' | 'linebreak';
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export interface TypeFlags {
  readonly isInline: boolean;
  readonly canInsertTextBefore: boolean;
  readonly canInsertTextAfter: boolean;
  readonly isKeyboardSelectable: boolean;
  readonly isIsolated: boolean;
  readonly isShadowRoot: boolean;
}
export interface TypeRow {
  readonly index: number;
  readonly name: string;
  readonly kind: Exclude<NodeKind, 'root'>;
  readonly flags?: TypeFlags;
}
export interface TextProps {
  readonly format: number;
  readonly mode: number;
  readonly detail: number;
  readonly style: string;
}
export interface ElementProps {
  readonly format: number;
  readonly indent: number;
  readonly direction: number;
  readonly textFormat: number;
  readonly style: string;
  readonly textStyle: string;
}
export interface ViewNode {
  readonly key: NodeKey;
  readonly type: string;
  readonly typeIndex: number;
  readonly kind: NodeKind;
  readonly parent: NodeKey | null;
  readonly children: readonly NodeKey[];
  readonly text: string;
  readonly textProps?: TextProps;
  readonly elementProps?: ElementProps;
  readonly propsJSON: string;
  readonly stateJSON: string;
  props(): JsonObject;
}
export interface Point {
  readonly key: NodeKey;
  readonly offset: number;
  readonly type: 'text' | 'element';
}
export type ViewSelection =
  | { readonly kind: 'none' | 'keep' }
  | {
      readonly kind: 'range';
      readonly anchor: Point;
      readonly focus: Point;
      readonly dirty?: boolean;
    }
  | { readonly kind: 'node'; readonly keys: readonly NodeKey[] }
  | {
      readonly kind: 'table';
      readonly table: NodeKey;
      readonly anchorCell: NodeKey;
      readonly focusCell: NodeKey;
    };
export interface ViewSelectionInfo {
  readonly selection: ViewSelection;
  readonly format: number;
  readonly style: string;
}
export type MutationKind = 'created' | 'updated' | 'destroyed';
export interface NodeMutation {
  readonly kind: MutationKind;
  readonly before?: ViewNode;
  readonly after?: ViewNode;
}
export interface AppliedDiff {
  readonly mutations: ReadonlyMap<NodeKey, NodeMutation>;
  readonly children: ReadonlySet<NodeKey>;
  readonly properties: ReadonlySet<NodeKey>;
  readonly fullReconcile: boolean;
  readonly viewTextMatches: NodeKey | null;
  readonly opCount: number;
}
