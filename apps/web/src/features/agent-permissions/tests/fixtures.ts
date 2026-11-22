import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
} from '@service-agent-harness/generated/schemas';

/**
 * Email (with a Send override), Documents (Delete only) and Tasks, which has
 * no tools yet.
 */
export const CATALOG: ToolPermissionCatalog = {
  version: 'v1',
  actions: [
    { action: 'create', name: 'Create', description: 'Make new things' },
    { action: 'read', name: 'Read', description: 'Look at things' },
    { action: 'update', name: 'Update', description: 'Change things' },
    { action: 'destroy', name: 'Delete', description: 'Remove things' },
    { action: 'send', name: 'Send', description: 'Reach other people' },
  ],
  groups: [
    {
      id: 'email',
      name: 'Email',
      description: 'Your mailbox',
      tools: [
        {
          service: 'email',
          operation: 'list_threads',
          action: 'read',
          label: 'List threads',
        },
        {
          service: 'email',
          operation: 'send_message',
          action: 'send',
          label: 'Send message',
        },
        {
          service: 'email',
          operation: 'forward_event',
          action: 'send',
          label: 'Forward calendar event',
        },
      ],
    },
    {
      id: 'documents',
      name: 'Documents',
      description: 'Notes and files',
      tools: [
        {
          service: 'storage',
          operation: 'delete_document',
          action: 'destroy',
          label: 'Delete document',
        },
      ],
    },
    { id: 'tasks', name: 'Tasks', description: 'Your to-dos', tools: [] },
  ],
};

/**
 * Email · Send is Ask, set by the agent itself; Forward calendar event is
 * set back to Always allow. Documents is all allowed, but has a saved Never
 * on Send, which no tool has: the server lists only the actions with tools
 * (Email's Read and Send, Documents' Delete) and no Tasks.
 */
export const VIEW: AgentToolPermissions = {
  agentId: 'agent-1',
  policyId: '0195dbd2-6539-7000-8000-0000000000a1',
  kind: 'agent',
  canEdit: true,
  canTighten: true,
  version: 'v1',
  restricted: 1,
  defaults: [
    { action: 'read', state: 'always', origin: 'default' },
    { action: 'create', state: 'always', origin: 'default' },
    { action: 'update', state: 'always', origin: 'default' },
    { action: 'send', state: 'always', origin: 'default' },
    { action: 'destroy', state: 'always', origin: 'default' },
  ],
  rules: [
    {
      target: { kind: 'group_action', group: 'email', action: 'send' },
      state: 'ask',
      viaAgent: true,
      updatedAt: '2026-11-17T10:00:00Z',
    },
    {
      target: { kind: 'tool', service: 'email', operation: 'forward_event' },
      state: 'always',
      viaAgent: false,
      updatedAt: '2026-11-17T11:00:00Z',
    },
    {
      target: { kind: 'group_action', group: 'documents', action: 'send' },
      state: 'never',
      viaAgent: false,
      updatedAt: '2026-11-17T12:00:00Z',
    },
  ],
  groups: [
    {
      group: 'email',
      actions: [
        {
          action: 'read',
          state: 'always',
          origin: 'default',
          exception: false,
          tools: 1,
          overrides: [],
        },
        {
          action: 'send',
          state: 'ask',
          origin: 'group_action',
          exception: true,
          tools: 2,
          overrides: [
            {
              service: 'email',
              operation: 'forward_event',
              label: 'Forward calendar event',
              state: 'always',
              origin: 'tool',
            },
          ],
        },
      ],
    },
    {
      group: 'documents',
      actions: [
        {
          action: 'destroy',
          state: 'always',
          origin: 'default',
          exception: false,
          tools: 1,
          overrides: [],
        },
      ],
    },
  ],
};
