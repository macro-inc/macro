import type { AgentSessionEntity, ChatEntity } from '@entity/types/entity';
export type HistoryMetadata =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'ready'; entity: AgentSessionEntity | ChatEntity };
