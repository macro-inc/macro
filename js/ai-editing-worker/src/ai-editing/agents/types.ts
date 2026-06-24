import type { AwarenessSource } from '../awareness/awareness-source';
import type { PeerPool } from '../awareness/peer-pool';
import type { Doc } from '../doc/doc';
import type { DocumentOp } from '../editor/ops';
import type { DocumentOpQueueParams } from '../queue/types';
import type { RunCodeToolOptions } from '../tools/run-code';

export type ContactResult =
  | { kind: 'user'; userId: string; email: string; name?: string }
  | {
      kind: 'contact';
      contactId: string;
      name: string;
      emailOrDomain: string;
      isCompany: boolean;
    };

export type SearchContacts = (query: string) => Promise<ContactResult[]>;

export type DocumentResult = {
  documentId: string;
  documentName: string;
  blockName: string;
};

export type SearchDocuments = (query: string) => Promise<DocumentResult[]>;

export type RunTaskDeps = {
  /** Shared document writer/reader (one per session). */
  doc: Doc;
  /** This writer's own cursor identity. */
  awarenessSource: AwarenessSource;
  runner: RunCodeToolOptions['runner'];
  /** Already-windowed document context the writer needs to see. */
  context: string;
  /** Verbatim text values available as `snippets.KEY` in the coder's JS execution context. */
  snippets?: Record<string, string>;
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  onOps?: RunCodeToolOptions['onOps'];
};

export type RunAgentOptions = {
  /** Push the edited session out to the live document (mirror → Loro). Called
   *  after every applied edit so the user sees changes (and typing) stream in. */
  propagate: () => void;
  /** Pool of named cursor identities; one peer is borrowed per concurrent writer. */
  peerPool: PeerPool;
  /** Build a writer's cursor identity. */
  makeAwareness: (name: string, color: string) => AwarenessSource;
  /** Resolve a name query to contact/user results. */
  searchContacts: SearchContacts;
  /** Resolve a name/keyword query to document results. */
  searchDocuments: SearchDocuments;
  /** Document serialization fed to the agents. Default 'xml'. */
  docFormat?: 'markdown' | 'xml';
  /** Run an intent-interpretation pass first. */
  interpret?: boolean;
  runner: RunCodeToolOptions['runner'];
  /** Animation tuning (speed, ranges). */
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  /** Collect every op batch as it is generated (before it is applied). */
  onOps?: (ops: DocumentOp[]) => void;
  /** Collect JS code blocks run by each coder, indexed by dispatch round then edit index. */
  onCoderResult?: (codes: string[][]) => void;
};
