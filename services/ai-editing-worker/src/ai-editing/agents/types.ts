import type { Span } from '@macro-inc/observability';
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
  /** Max model steps for this coder. `runCode` takes arbitrary JS, so any edit
   *  can be expressed in ONE call; further steps are error recovery. */
  maxSteps?: number;
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
  /** This coder's `edit.dispatch` span; parents its `edit.run_code` children. */
  span?: Span;
  onRunCodeResult?: RunCodeToolOptions['onRunCodeResult'];
};

export type RunAgentOptions = {
  borrowWriter: () => Promise<Writer>;
  /** Overrides the per-coder step cap; see RunTaskDeps.maxSteps. */
  maxCoderSteps?: number;
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
