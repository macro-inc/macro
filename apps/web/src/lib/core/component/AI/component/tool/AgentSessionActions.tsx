import Robot from '@phosphor-icons/core/regular/robot.svg';
import type { ToolName } from '@service-cognition/generated/tools/tool';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { MagicChip } from '../../../LexicalMarkdown/component/decorator/MagicChip';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, useToolError } from './ToolRenderer';

type SharingTool = Extract<
  ToolName,
  'ReadAgentSessionSharing' | 'UpdateAgentSessionSharing'
>;
function sharingHandler<T extends SharingTool>(name: T, label: string) {
  return createToolRenderer({
    name,
    render: (ctx) => {
      const [expanded, setExpanded] = createSignal(false);
      const error = () => useToolError();
      return (
        <BaseTool
          icon={Robot}
          renderContext={ctx.renderContext}
          type="call"
          response={
            <Show when={expanded() && ctx.response?.data}>
              {(settings) => (
                <div class="space-y-2 p-3 text-xs">
                  <p>
                    Link access:{' '}
                    {settings().linkScope === 'off'
                      ? 'Off'
                      : `${settings().linkScope} · ${settings().linkAccess ?? 'view'}`}
                  </p>
                  <p>Team access: {settings().teamAccess ?? 'Off'}</p>
                  <For
                    each={settings().channels}
                    fallback={<p>No channel grants</p>}
                  >
                    {(grant) => (
                      <p class="break-words">
                        Channel {grant.channelId}: {grant.access}
                      </p>
                    )}
                  </For>
                </div>
              )}
            </Show>
          }
        >
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span>{label}</span>
            <Tool.ResultToggle
              expanded={expanded()}
              onToggle={() => setExpanded((value) => !value)}
              showToggle={!!ctx.response}
              status={
                error()
                  ? 'Could not confirm'
                  : ctx.response
                    ? 'Complete'
                    : undefined
              }
            />
          </div>
        </BaseTool>
      );
    },
  });
}
export const createAgentSessionHandler = createToolRenderer({
  name: 'CreateAgentSession',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <p role="status" class="py-2 text-sm text-ink-muted">
            {error()
              ? 'Could not confirm session creation'
              : 'Starting agent session…'}
          </p>
        }
      >
        {(result) => (
          <Suspense fallback={<p role="status">Loading agent session…</p>}>
            <MagicChip
              agentSessionId={result().agent_session_id}
              promptedMessage={{ turn: 0, author: 'user' }}
              status="booting"
            />
          </Suspense>
        )}
      </Show>
    );
  },
});
export const manageAgentSessionHandler = createToolRenderer({
  name: 'ManageAgentSession',
  render: (ctx) => {
    const error = () => useToolError();
    const label = () => {
      switch (ctx.tool.data.action.type) {
        case 'rename':
          return 'Rename agent session';
        case 'archive':
          return ctx.tool.data.action.archived
            ? 'Archive agent session'
            : 'Unarchive agent session';
        case 'delete':
          return 'Delete agent session';
        case 'prompt':
          return 'Send prompt to agent';
        case 'stop':
          return 'Stop agent';
      }
    };
    const status = () => {
      if (error()) return 'Could not confirm';
      const result = ctx.response?.data;
      if (!result) return undefined;
      if (result.status === 'queued') return 'Queued';
      if (result.status === 'sent') return 'Sent';
      return result.message;
    };
    return (
      <BaseTool icon={Robot} renderContext={ctx.renderContext} type="call">
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>{label()}</span>
          <span class="text-ink-muted">{status()}</span>
        </div>
      </BaseTool>
    );
  },
});
export const readAgentSessionSharingHandler = sharingHandler(
  'ReadAgentSessionSharing',
  'Read session sharing'
);
export const updateAgentSessionSharingHandler = sharingHandler(
  'UpdateAgentSessionSharing',
  'Update session sharing'
);
