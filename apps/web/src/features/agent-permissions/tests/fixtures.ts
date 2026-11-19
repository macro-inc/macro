import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
} from '@service-agent-harness/generated/schemas';

/** Two groups: Email (with a Send override) and Documents. */
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
  ],
};

const allAlways = (group: string) => ({
  group,
  actions: (['create', 'read', 'update', 'destroy', 'send'] as const).map(
    (action) => ({
      action,
      state: 'always' as const,
      origin: 'default' as const,
      tools: 0,
      overrides: [],
    })
  ),
});

/**
 * Email · Send is Ask, set by the agent itself; Forward calendar event is
 * set back to Always allow. Documents is all allowed.
 */
export const VIEW: AgentToolPermissions = {
  agentId: 'agent-1',
  kind: 'agent',
  canEdit: true,
  canTighten: true,
  version: 'v1',
  restricted: 1,
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
  ],
  groups: [
    {
      group: 'email',
      actions: [
        {
          action: 'create',
          state: 'always',
          origin: 'default',
          tools: 0,
          overrides: [],
        },
        {
          action: 'read',
          state: 'always',
          origin: 'default',
          tools: 1,
          overrides: [],
        },
        {
          action: 'update',
          state: 'always',
          origin: 'default',
          tools: 0,
          overrides: [],
        },
        {
          action: 'destroy',
          state: 'always',
          origin: 'default',
          tools: 0,
          overrides: [],
        },
        {
          action: 'send',
          state: 'ask',
          origin: 'group_action',
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
    allAlways('documents'),
  ],
};
