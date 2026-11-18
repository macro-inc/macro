/**
 * Wire shapes of the agent harness's tool-permission API
 * (`/agent-tool-permissions/catalog`, `/agents/{id}/tool-permissions`).
 */

export type PermissionStateDto = 'always' | 'ask' | 'never';

export type ActionDto = 'create' | 'read' | 'update' | 'destroy' | 'send';

export type ToolPermissionTarget =
  | { kind: 'group_action'; group: string; action: ActionDto }
  | { kind: 'tool'; service: string; operation: string };

export type ToolPermissionChange = {
  target: ToolPermissionTarget;
  state: PermissionStateDto | null;
};

export type ToolPermissionChanges = { changes: ToolPermissionChange[] };

export type CatalogAction = {
  action: ActionDto;
  name: string;
  description: string;
};

export type CatalogTool = {
  service: string;
  operation: string;
  action: ActionDto;
  label: string;
};

export type CatalogGroup = {
  id: string;
  name: string;
  description: string;
  tools: CatalogTool[];
};

export type ToolPermissionCatalog = {
  version: string;
  actions: CatalogAction[];
  groups: CatalogGroup[];
};

export type ToolPermissionRule = {
  target: ToolPermissionTarget;
  state: PermissionStateDto;
  viaAgent: boolean;
  updatedAt: string;
};

export type ToolOverride = {
  service: string;
  operation: string;
  label: string;
  state: PermissionStateDto;
  origin: 'tool' | 'session';
};

export type ActionPermission = {
  action: ActionDto;
  state: PermissionStateDto;
  origin: 'group_action' | 'default' | 'session';
  tools: number;
  overrides: ToolOverride[];
};

export type GroupPermissions = {
  group: string;
  actions: ActionPermission[];
};

export type AgentToolPermissions = {
  agentId: string;
  kind: 'agent' | 'persona';
  canEdit: boolean;
  canTighten: boolean;
  version: string;
  restricted: number;
  rules: ToolPermissionRule[];
  sessionRules?: ToolPermissionRule[];
  groups: GroupPermissions[];
};
