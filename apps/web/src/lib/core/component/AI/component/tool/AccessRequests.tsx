import { ItemPreview } from '@core/component/ItemPreview';
import LockKey from '@icon/system/regular/lock-key.svg';
import type { RequestableEntityType } from '@service-cognition/generated/tools/types';
import type { ItemType } from '@service-storage/client';
import { Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer, useToolError } from './ToolRenderer';

/** External chats have no item preview; their name stays in the agent's reply. */
const ITEM_TYPES: Record<RequestableEntityType, ItemType | undefined> = {
  document: 'document',
  project: 'project',
  initiative: 'initiative',
  database: 'database',
  call: 'call',
  email_thread: 'email',
  agent_session: 'agent_session',
  external_chat: undefined,
};

function Item(props: { type: RequestableEntityType; id: string }) {
  return (
    <Show when={ITEM_TYPES[props.type]} fallback="an item">
      {(type) => (
        <Suspense>
          <ItemPreview
            class="inline-flex align-middle ring-0"
            id={props.id}
            type={type()}
          />
        </Suspense>
      )}
    </Show>
  );
}

export const requestEntityAccessHandler = createToolRenderer({
  name: 'RequestEntityAccess',
  render: (ctx) => {
    const error = () => useToolError();
    const verb = () => {
      if (error()) return 'Could not request';
      return ctx.response ? 'Requested' : 'Requesting';
    };
    return (
      <BaseTool icon={LockKey} renderContext={ctx.renderContext} type="call">
        <div class="min-w-0 flex-1">
          {verb()} {ctx.tool.data.access} access to{' '}
          <Item type={ctx.tool.data.entityType} id={ctx.tool.data.entityId} />
          <Show when={ctx.response?.data}>
            {(response) => (
              <span class="text-ink-muted"> · {response().status}</span>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const readEntityAccessRequestHandler = createToolRenderer({
  name: 'ReadEntityAccessRequest',
  render: (ctx) => (
    <BaseTool icon={LockKey} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Checked access to{' '}
        <Item type={ctx.tool.data.entityType} id={ctx.tool.data.entityId} />
        <Show when={ctx.response?.data.request}>
          {(request) => (
            <span class="text-ink-muted">
              {' '}
              · {request().requestedLevel} request {request().status}
            </span>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});
