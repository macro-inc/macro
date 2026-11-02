import { ItemPreview } from '@core/component/ItemPreview';
import ChatCircleDots from '@icon/system/regular/chat-circle-dots.svg';
import PencilSimple from '@icon/system/regular/pencil-simple.svg';
import Smiley from '@icon/system/regular/smiley.svg';
import Trash from '@icon/system/regular/trash.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

function ChannelPreview(props: { channelId: string }) {
  return (
    <Suspense>
      <ItemPreview
        class="inline-flex align-middle ring-0"
        id={props.channelId}
        type="channel"
      />
    </Suspense>
  );
}

export const editChannelMessageHandler = createToolRenderer({
  name: 'EditChannelMessage',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);

    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <p class="whitespace-pre-wrap break-words rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
              {ctx.tool.data.content}
            </p>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {ctx.response ? 'Edited a message in' : 'Edit a message in'}{' '}
            <ChannelPreview channelId={ctx.tool.data.channelId} />
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!ctx.tool.data.content}
          />
        </div>
      </BaseTool>
    );
  },
});

export const deleteChannelMessageHandler = createToolRenderer({
  name: 'DeleteChannelMessage',
  render: (ctx) => (
    <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        {ctx.response ? 'Deleted a message in' : 'Delete a message in'}{' '}
        <ChannelPreview channelId={ctx.tool.data.channelId} />
      </div>
    </BaseTool>
  ),
});

export const reactToChannelMessageHandler = createToolRenderer({
  name: 'ReactToChannelMessage',
  render: (ctx) => {
    const removing = () => ctx.tool.data.action === 'remove';
    const verb = () => {
      if (removing()) return ctx.response ? 'Removed' : 'Remove';
      return ctx.response ? 'Reacted' : 'React';
    };

    return (
      <BaseTool icon={Smiley} renderContext={ctx.renderContext} type="call">
        <div class="min-w-0 flex-1">
          {verb()} <span class="text-ink">{ctx.tool.data.emoji}</span>{' '}
          {removing() ? 'from' : 'to'} a message in{' '}
          <ChannelPreview channelId={ctx.tool.data.channelId} />
        </div>
      </BaseTool>
    );
  },
});

export const openDirectMessageHandler = createToolRenderer({
  name: 'OpenDirectMessage',
  render: (ctx) => {
    const participants = () =>
      (ctx.response?.data.participants ?? ctx.tool.data.participants)
        .map((id) => (id.startsWith('macro|') ? id.slice('macro|'.length) : id))
        .join(', ');

    return (
      <BaseTool
        icon={ChatCircleDots}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="min-w-0 flex-1">
          <Show
            when={ctx.response?.data}
            fallback={
              <>
                Open a direct message with{' '}
                <span class="text-ink">{participants()}</span>
              </>
            }
          >
            {(response) => (
              <>
                {response().created ? 'Started' : 'Opened'}{' '}
                <ChannelPreview channelId={response().channelId} /> with{' '}
                <span class="text-ink">{participants()}</span>
              </>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});
