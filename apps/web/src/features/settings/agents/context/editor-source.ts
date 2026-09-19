import type { Accessor } from 'solid-js';
import type { AgentDraft, AgentRuntime, ModelCatalog } from '../core/types';

/** Capabilities needed by the editor; request and cache mechanics stay with its host. */
export type AgentEditorSource = {
  runtimes: Accessor<readonly AgentRuntime[]>;
  catalog: (runtimeId: string) => ModelCatalog;
  retryModels: (runtimeId: string) => Promise<void>;
  pending: Accessor<boolean>;
  save: (draft: AgentDraft) => Promise<boolean>;
  canShareWithTeam: Accessor<boolean>;
  canMakePrivate: Accessor<boolean>;
  teamId: Accessor<string | undefined>;
};
