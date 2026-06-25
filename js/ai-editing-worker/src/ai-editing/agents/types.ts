import type { AwarenessSource } from '../awareness/awareness-source';
import type { PeerPool } from '../awareness/peer-pool';
import type { Doc } from '../doc/doc';
import type { DocumentOp } from '../editor/ops';
import type { DocumentOpQueueParams } from '../queue/types';
import type { RunCodeToolOptions } from '../tools/run-code';

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
  propagate: () => void;
  peerPool: PeerPool;
  makeAwareness: (name: string, color: string) => AwarenessSource;
  docFormat?: 'markdown' | 'xml';
  interpret?: boolean;
  runner: RunCodeToolOptions['runner'];
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  onOps?: (ops: DocumentOp[]) => void;
  onCoderResult?: (codes: string[][]) => void;
};
