import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOp } from '../editor';
import type { DocumentOpQueueParams } from '../queue';
import type { RunCodeToolOptions, Writer } from '../tools';

export type RunTaskDeps = {
  doc: Doc;
  awarenessSource: AwarenessSource;
  runner: RunCodeToolOptions['runner'];
  context: string;
  snippets?: Record<string, string>;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  onOps?: RunCodeToolOptions['onOps'];
};

export type RunAgentOptions = {
  borrowWriter: () => Promise<Writer>;
  docFormat?: 'markdown' | 'xml';
  interpret?: boolean;
  runner: RunCodeToolOptions['runner'];
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  onOps?: (ops: DocumentOp[]) => void;
  onCoderResult?: (codes: string[][]) => void;
};
