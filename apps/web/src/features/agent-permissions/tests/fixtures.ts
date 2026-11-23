import type {
  AgentToolPermissions,
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionRule,
  ToolPermissionState,
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

/**
 * Six entity types, as the registry groups them. Tasks has no Send tool, so
 * a rule saved on Tasks · Send is hidden.
 */
export const ENTITY_CATALOG: ToolPermissionCatalog = {
  version: 'v2',
  actions: [
    { action: 'read', name: 'Read', description: 'Look at things' },
    { action: 'create', name: 'Create', description: 'Make new things' },
    { action: 'update', name: 'Edit', description: 'Change things' },
    { action: 'send', name: 'Send', description: 'Reach other people' },
    { action: 'destroy', name: 'Delete', description: 'Remove things' },
  ],
  groups: [
    {
      id: 'documents',
      name: 'Documents & projects',
      description: 'Notes and files',
      tools: [
        {
          service: 'storage',
          operation: 'get_document',
          action: 'read',
          label: 'Read document',
        },
        {
          service: 'storage',
          operation: 'delete_document',
          action: 'destroy',
          label: 'Delete document',
        },
      ],
    },
    {
      id: 'tasks',
      name: 'Tasks',
      description: 'Tasks',
      tools: [
        {
          service: 'storage',
          operation: 'list_tasks',
          action: 'read',
          label: 'List tasks',
        },
      ],
    },
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
      ],
    },
    {
      id: 'channels',
      name: 'Channels & messages',
      description: 'Messages',
      tools: [
        {
          service: 'storage',
          operation: 'get_messages',
          action: 'read',
          label: 'Read messages',
        },
        {
          service: 'storage',
          operation: 'entity_message_create',
          action: 'send',
          label: 'Send a message',
        },
      ],
    },
    {
      id: 'external_chats',
      name: 'Outside chats',
      description: 'WhatsApp',
      tools: [
        {
          service: 'external',
          operation: 'list_chats',
          action: 'read',
          label: 'List chats',
        },
      ],
    },
    {
      id: 'contacts',
      name: 'Contacts & CRM',
      description: 'Contacts',
      tools: [
        {
          service: 'crm',
          operation: 'search_contacts',
          action: 'read',
          label: 'Search contacts',
        },
      ],
    },
  ],
};

const ENTITY_DEFAULTS: Record<PermissionAction, ToolPermissionState> = {
  read: 'always',
  create: 'ask',
  update: 'ask',
  send: 'ask',
  destroy: 'never',
};

const at = '2026-11-20T10:00:00Z';

/**
 * Read Allow with two exceptions (Contacts & CRM Ask, Outside chats Never),
 * Create, Edit and Send Ask, Delete Never; a hidden Tasks · Send exception;
 * and the agent's own Never on Email's Send message tool.
 */
const ENTITY_RULES: ToolPermissionRule[] = [
  {
    target: { kind: 'action', action: 'create' },
    state: 'ask',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'action', action: 'update' },
    state: 'ask',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'action', action: 'send' },
    state: 'ask',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'action', action: 'destroy' },
    state: 'never',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'group_action', group: 'contacts', action: 'read' },
    state: 'ask',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'group_action', group: 'external_chats', action: 'read' },
    state: 'never',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'group_action', group: 'tasks', action: 'send' },
    state: 'always',
    viaAgent: false,
    updatedAt: at,
  },
  {
    target: { kind: 'tool', service: 'email', operation: 'send_message' },
    state: 'never',
    viaAgent: true,
    updatedAt: at,
  },
];

/** The server's view of `ENTITY_RULES`: only pairs with tools are listed. */
export const ENTITY_VIEW: AgentToolPermissions = {
  agentId: 'agent-2',
  policyId: '0195dbd2-6539-7000-8000-0000000000a2',
  kind: 'agent',
  canEdit: true,
  canTighten: true,
  version: 'v2',
  restricted: 9,
  defaults: (['read', 'create', 'update', 'send', 'destroy'] as const).map(
    (action) => ({
      action,
      state: ENTITY_DEFAULTS[action],
      origin: action === 'read' ? 'default' : 'action',
    })
  ),
  rules: ENTITY_RULES,
  groups: ENTITY_CATALOG.groups.map((group) => ({
    group: group.id,
    actions: (['read', 'create', 'update', 'send', 'destroy'] as const)
      .filter((action) => group.tools.some((tool) => tool.action === action))
      .map((action) => {
        const exception = ENTITY_RULES.find(
          (rule) =>
            rule.target.kind === 'group_action' &&
            rule.target.group === group.id &&
            rule.target.action === action
        );
        const overrides =
          group.id === 'email' && action === 'send'
            ? [
                {
                  service: 'email',
                  operation: 'send_message',
                  label: 'Send message',
                  state: 'never' as const,
                  origin: 'tool' as const,
                },
              ]
            : [];
        return {
          action,
          state: exception?.state ?? ENTITY_DEFAULTS[action],
          origin: exception ? ('group_action' as const) : ('action' as const),
          tools: group.tools.filter((tool) => tool.action === action).length,
          overrides,
          exception: exception !== undefined,
        };
      }),
  })),
};
