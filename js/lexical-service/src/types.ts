export type SearchableNode = {
  nodeId: string,
  /** Plain text search content */
  content: string,
  /** Raw JSON content */
  rawContent: string
};

export type CognitionNode = {
  nodeId: string,
  type: string,
  /** Markdown text search content */
  content: string,
  /** Raw JSON content */
  rawContent: string,
};
