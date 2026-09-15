export type ChannelContentKind = 'files' | 'tasks' | 'calls' | 'agents';

export type SharedReference = {
  entity_id: string;
  entity_type: string;
  created_at: string;
};
