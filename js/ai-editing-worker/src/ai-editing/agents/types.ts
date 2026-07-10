import type { AwarenessSource } from '../awareness';
import type { Doc } from '../doc';
import type { DocumentOp } from '../editor';
import type { DocumentOpQueueParams } from '../queue';
import type {
  CoderRunCode,
  DispatchEditTrace,
  RunCodeToolOptions,
  Writer,
} from '../tools';

export type RunTaskDeps = {
  doc: Doc;
  awarenessSource: AwarenessSource;
  runner: RunCodeToolOptions['runner'];
  context: string;
  /** The user's original edit request (plus resolved intent when available),
   *  tone and content context for the writer. */
  request?: string;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onOps?: RunCodeToolOptions['onOps'];
  onRunCode?: RunCodeToolOptions['onRunCode'];
};

export type RunAgentOptions = {
  borrowWriter: () => Promise<Writer>;
  docFormat?: 'markdown' | 'xml';
  interpret?: boolean;
  runner: RunCodeToolOptions['runner'];
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onOps?: (ops: DocumentOp[]) => void;
  onCoderResult?: (codes: CoderRunCode[]) => void;
  onEditTrace?: (edit: DispatchEditTrace) => void;
};
