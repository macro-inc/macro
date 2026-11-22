// An agent session where permissions shaped the turn: a program blocked by a
// Never setting, a hold answered for the session, a ShowPermissions card, a
// declined program, and a hold waiting above the composer. The harness's
// permission routes answer from memory. `?viewer=other` shows it to someone
// who can't edit the agent and isn't the approver; `?theme=light` lights it.
// The programs are JS tools ones (opencode's JavaScript dialect), with saved
// records; `?view=page` shows the agent's permissions page instead of the
// session.

import { AgentPermissionsPage } from '@app/features/agent-permissions';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentToolPermissions,
  ExecutionPermission,
  ExecutionRecord,
  GatedOperation,
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionChanges,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { toolPermissionsClient } from '@service-agent-harness/tool-permissions';
import { QueryClientProvider } from '@tanstack/solid-query';
import { UserMessageBubble } from '@ui';
import { err, ok } from 'neverthrow';
import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { Message } from '../component/AgentMessage';
import { ToolApprovalRequest } from '../component/ToolApprovalRequest';
import { OWNER, session, showSession, VIEWER } from './permissions-session';
import '@fontsource-variable/inter';
import '../../../index.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme(params.get('theme') === 'light' ? 'Macro Light' : 'Macro Dark');

const SESSION_ID = session.sessionId();
const LANGUAGE = 'js_tools';
const ACTIONS: PermissionAction[] = [
  'create',
  'read',
  'update',
  'destroy',
  'send',
];

const CATALOG: ToolPermissionCatalog = {
  version: 'fixture',
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
        {
          service: 'email',
          operation: 'delete_label',
          action: 'destroy',
          label: 'Delete label',
        },
        {
          service: 'email',
          operation: 'delete_email_filter',
          action: 'destroy',
          label: 'Delete email filter',
        },
      ],
    },
    {
      id: 'documents',
      name: 'Documents',
      description: 'Notes and files',
      tools: [
        {
          service: 'documents',
          operation: 'edit_document',
          action: 'update',
          label: 'Edit document',
        },
        {
          service: 'documents',
          operation: 'rename_document',
          action: 'update',
          label: 'Rename document',
        },
        {
          service: 'documents',
          operation: 'delete_document',
          action: 'destroy',
          label: 'Delete document',
        },
      ],
    },
  ],
};

// Saved group action settings; everything else is Always allow. Documents
// asks for every action it has tools for, so its summary says so once.
const saved: Record<string, ToolPermissionState> = {
  'email.send': 'ask',
  'email.destroy': 'never',
  'documents.update': 'ask',
  'documents.destroy': 'ask',
};

function view(): AgentToolPermissions {
  return {
    agentId: 'agent-1',
    policyId: '0195dbd2-6539-7000-8000-0000000000a1',
    kind: 'agent',
    canEdit: VIEWER === OWNER,
    canTighten: true,
    version: CATALOG.version,
    restricted: Object.keys(saved).length,
    defaults: ACTIONS.map((action) => ({
      action,
      state: 'always',
      origin: 'default',
    })),
    rules: Object.entries(saved).map(([key, state]) => {
      const [group, action] = key.split('.') as [string, PermissionAction];
      return {
        target: { kind: 'group_action', group, action },
        state,
        viaAgent: false,
        updatedAt: '2026-11-18T10:00:00Z',
      };
    }),
    // As the server: only the actions a tool has, and groups with one.
    groups: CATALOG.groups
      .filter((group) => group.tools.length > 0)
      .map((group) => ({
        group: group.id,
        actions: ACTIONS.flatMap((action) => {
          const tools = group.tools.filter(
            (tool) => tool.action === action
          ).length;
          if (tools === 0) return [];
          const state = saved[`${group.id}.${action}`];
          return [
            {
              action,
              state: state ?? 'always',
              origin: state ? 'group_action' : 'default',
              exception: state !== undefined,
              tools,
              overrides: [],
            },
          ];
        }),
      })),
  };
}

Object.assign(toolPermissionsClient, {
  catalog: async () => ok(CATALOG),
  session: async () => ok(view()),
  get: async () => ok(view()),
  set: async (_agent: string, body: ToolPermissionChanges) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const change of body.changes) {
      if (change.target.kind !== 'group_action') continue;
      const key = `${change.target.group}.${change.target.action}`;
      if (!change.state || change.state === 'always') delete saved[key];
      else saved[key] = change.state;
    }
    document.body.dataset.saved = JSON.stringify(saved);
    return ok(view());
  },
});

const op = (
  group: 'email' | 'documents',
  operation: string,
  state: ToolPermissionState
): GatedOperation => {
  const catalogGroup = CATALOG.groups.find((entry) => entry.id === group);
  const tool = catalogGroup?.tools.find(
    (entry) => entry.operation === operation
  );
  return {
    service: group,
    operation,
    label: tool?.label ?? operation,
    group,
    groupName: catalogGroup?.name ?? group,
    action: tool?.action,
    state,
    origin: 'group_action',
  };
};

const executionId = (n: number) =>
  `019a0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

// The programs' saved records, by execution id.
const records = new Map<string, ExecutionRecord>();
Object.assign(agentHarnessServiceClient, {
  getCodeExecution: async (_session: string, id: string) => {
    const record = records.get(id);
    if (record) return ok(record);
    return err([
      Object.assign(new Error('No such execution'), { code: 'NOT_FOUND' }),
    ]);
  },
});

function program(
  id: string,
  n: number,
  permission: ExecutionPermission,
  source: string
): MessagePart {
  records.set(executionId(n), {
    executionId: executionId(n),
    source,
    language: LANGUAGE,
    sdkFingerprint: '@opencode/codemode@2.3.2+0123456789ab',
    status: 'failed',
    calls: [],
    activity: [],
    permission,
  });
  return {
    kind: 'tool_use',
    id,
    name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
    status: 'failed',
    detail: {
      kind: 'other',
      acpKind: 'other',
      input: { source, language: LANGUAGE },
      output: null,
      result: {
        executionId: executionId(n),
        status: 'failed',
        error: 'permission',
        permission,
      },
      error: null,
    },
  };
}

const ASKED = [
  op('email', 'send_message', 'ask'),
  op('documents', 'edit_document', 'ask'),
  op('documents', 'rename_document', 'ask'),
];
const SOURCE = `const report = await tools.documents.get_document({ path: { id: "weekly-report" } })
await tools.documents.edit_document({ path: { id: report.id }, body: { content: report.markdown } })
await tools.documents.rename_document({ path: { id: report.id }, body: { name: "Weekly report" } })
await tools.email.send_message({
  body: { to: ["team@example.com"], subject: "Weekly report", body: report.summary },
})
return { documentId: report.id }`;

function hold(
  approvalId: string,
  status: 'pending' | 'approved',
  remembered: boolean
): MessagePart {
  return {
    kind: 'tool_approval',
    approvalId,
    serverSlug: 'macro-sdk',
    serverName: 'Macro',
    toolName: 'ExecuteCode',
    arguments: {
      source: SOURCE,
      permission: {
        executionId: executionId(9),
        language: LANGUAGE,
        operations: ASKED,
      },
    },
    requestedBy: OWNER,
    status,
    resolvedBy: status === 'pending' ? null : OWNER,
    remembered,
    approver: OWNER,
  };
}

const text = (value: string): MessagePart => ({ kind: 'text', text: value });

const reply: FoldedMessage = {
  agentSessionId: SESSION_ID,
  key: '1:agent',
  turn: 1,
  author: { kind: 'agent' },
  requestId: null,
  stop: null,
  pending: false,
  segments: [],
  phase: null,
  postedAt: null,
  parts: [
    program(
      'blocked',
      1,
      {
        outcome: 'blocked',
        operations: [
          op('email', 'delete_label', 'never'),
          op('email', 'delete_email_filter', 'never'),
        ],
      },
      'await tools.email.delete_label({ path: { id: "old" } })'
    ),
    text(
      'I can’t delete email labels: deleting email is set to Never for me. I’ve left them as they are. For the report, sending email needs your OK.'
    ),
    hold('answered', 'approved', true),
    program(
      'declined',
      2,
      {
        outcome: 'declined',
        status: 'denied',
        operations: [op('email', 'send_message', 'ask')],
      },
      'await tools.email.send_message({ body: {} })'
    ),
    text(
      'Want me to stop asking before sending email? You can change it here:'
    ),
    {
      kind: 'tool_use',
      id: 'show',
      name: { kind: 'mcp', server: 'macro_internal', tool: 'ShowPermissions' },
      status: 'completed',
      detail: {
        kind: 'other',
        acpKind: 'other',
        input: { groups: [{ group: 'email', actions: ['send'] }] },
        output: null,
        result: {
          agentId: 'agent-1',
          sessionId: SESSION_ID,
          selection: {
            groups: [{ group: 'email', actions: ['send'] }],
            tools: [{ service: 'email', operation: 'send_message' }],
          },
          reason:
            'I need to send the weekly report to the team, but sending email is set to Ask.',
          current: [],
          message: 'Shown to the person with controls.',
        },
        error: null,
      },
    },
    hold('waiting', 'pending', false),
  ],
};

showSession(
  [reply],
  params.get('pending') === '0'
    ? []
    : [
        {
          kind: 'tool_approval',
          approvalId: 'waiting',
          turn: 1,
          serverSlug: 'macro-sdk',
          serverName: 'Macro',
          toolName: 'ExecuteCode',
          requestedBy: OWNER,
          approver: OWNER,
        },
      ]
);

/** The agent's permissions page, as Settings → Agents opens it. */
function PageFixture() {
  return (
    <main class="h-dvh overflow-y-auto px-4 py-6">
      <div class="mx-auto max-w-3xl">
        <AgentPermissionsPage
          agentId="agent-1"
          agentName="Scout"
          backLabel="Agents"
          onBack={() => {}}
        />
      </div>
    </main>
  );
}

function SessionFixture() {
  return (
    <main class="flex h-dvh flex-col">
      <section
        aria-label="Agent session"
        class="min-h-0 flex-1 overflow-y-auto py-6"
      >
        <div class="macro-message-width mx-auto min-w-0 px-4 pb-4">
          <div class="flex w-full flex-col items-end">
            <UserMessageBubble>
              <p class="whitespace-pre-wrap">
                Clean up my email labels and send the weekly report to the team.
              </p>
            </UserMessageBubble>
          </div>
        </div>
        <div class="macro-message-width mx-auto min-w-0 px-4">
          <For each={session.messages()}>
            {(message) => <Message message={message} inFlight={false} />}
          </For>
        </div>
      </section>
      <div class="macro-message-width mx-auto flex w-full min-w-0 flex-col gap-2 px-4 pb-4">
        <For each={session.toolApprovals.pending()}>
          {(request) => <ToolApprovalRequest request={request} />}
        </For>
        {/* Stands in for the composer, so the hold sits where it does in
            the app. */}
        <div class="rounded-3xl border border-edge-muted bg-panel px-5 py-4 text-sm text-ink-extra-muted">
          Message the agent, @mention anything
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      {/* The dev server turns enable-agent-permissions on (LOCAL_ONLY);
          VITE_ENABLE_AGENT_PERMISSIONS=false turns it off. */}
      <AnalyticsContextProvider>
        <PosthogProvider>
          <Show
            when={params.get('view') === 'page'}
            fallback={<SessionFixture />}
          >
            <PageFixture />
          </Show>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
