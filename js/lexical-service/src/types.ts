export type SearchableNode = {
  nodeId: string;
  /** Plain text search content */
  content: string;
  /** Raw JSON content */
  rawContent: string;
};

export type CognitionNode = {
  nodeId: string;
  type: string;
  /** Markdown text search content */
  content: string;
  /** Raw JSON content */
  rawContent: string;
};

export type GenericNode = {
  type: 'generic';
  nodeId: string;
  content: string;
  tag: string;
};

export type ImageNodeData =
  | { type: 'staticImage'; url: string }
  | { type: 'dssImage'; id: string };

export type NewMdNode = GenericNode | ImageNodeData;
