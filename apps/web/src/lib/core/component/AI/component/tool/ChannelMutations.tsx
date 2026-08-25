import { ItemPreview } from '@core/component/ItemPreview';
import Hash from '@phosphor-icons/core/regular/hash.svg';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import Users from '@phosphor-icons/core/regular/users.svg';
import { invalidateChannelParticipants } from '@queries/channel/channel-participants';
import { upsertListChannel } from '@queries/channel/channels';
import { setPreviewName } from '@queries/preview';
import { setPreviewOnCreate } from '@queries/preview/preview';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
} from '@queries/soup/cache';
import type {
  CreateChannelResponse,
  RenameChannelResponse,
} from '@service-cognition/generated/tools/types';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { createEffect, createSignal, For, on, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

function applyCreatedChannel(data: CreateChannelResponse) {
  upsertListChannel({
    id: data.channelId,
    name: data.name,
    channel_type:
      data.channelType === 'team' ? ChannelType.team : ChannelType.private,
  });
  setPreviewOnCreate({
    itemId: data.channelId,
    itemType: 'channel',
    name: data.name,
  });
}

function applyRenamedChannel(data: RenameChannelResponse) {
  upsertListChannel({
    id: data.channelId,
    name: data.name,
  });
  setPreviewName({
    itemId: data.channelId,
    name: data.name,
    itemType: 'channel',
  });
  const soup = getSoupEntityById(data.channelId);
  if (soup?.tag === 'channel') {
    optimisticUpdateSoupEntity({
      tag: 'channel',
      data: { channel: { id: data.channelId, name: data.name } },
      frecency_score: soup.frecency_score,
    });
  }
}

function useWhenPresent<T>(
  value: () => T | undefined,
  apply: (value: T) => void
) {
  createEffect(
    on(value, (next) => {
      if (next) apply(next);
    })
  );
}

type Detail = {
  label: string;
  value?: string | null;
};

function DetailPanel(props: { details: Detail[]; summary?: string }) {
  const details = () => props.details.filter((detail) => detail.value != null);

  return (
    <div class="rounded-lg border border-edge-muted bg-ink/[0.02] p-3">
      <Show when={props.summary}>
        <p class="mb-2 text-xs text-ink-muted">{props.summary}</p>
      </Show>
      <dl class="flex flex-col gap-2">
        <For each={details()}>
          {(detail) => (
            <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
              <dt class="text-ink-extra-muted">{detail.label}</dt>
              <dd class="min-w-0 break-all text-ink">{detail.value}</dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
}

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

function displayParticipant(id: string) {
  return id.startsWith('macro|') ? id.slice('macro|'.length) : id;
}

const createChannelHandler = createToolRenderer({
  name: 'CreateChannel',
  handleResponse: (ctx) => {
    applyCreatedChannel(ctx.tool.data);
  },
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    const participants = () => response()?.participants ?? [];
    useWhenPresent(response, applyCreatedChannel);

    return (
      <BaseTool
        icon={Hash}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <div class="flex flex-col gap-2">
              <DetailPanel
                summary={response()!.summary}
                details={[
                  { label: 'Type', value: response()!.channelType },
                  {
                    label: 'Members',
                    value:
                      participants().length > 0
                        ? participants().map(displayParticipant).join(', ')
                        : 'Owner only',
                  },
                ]}
              />
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Created channel' : 'Create channel'}{' '}
            <Show
              when={response()}
              fallback={<span class="text-ink">{ctx.tool.data.name}</span>}
            >
              {(created) => <ChannelPreview channelId={created().channelId} />}
            </Show>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={
              ctx.response
                ? ctx.tool.data.channelType === 'team'
                  ? 'Team'
                  : 'Private'
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const renameChannelHandler = createToolRenderer({
  name: 'RenameChannel',
  handleResponse: (ctx) => {
    applyRenamedChannel(ctx.tool.data);
  },
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    useWhenPresent(response, applyRenamedChannel);

    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              summary={response()!.summary}
              details={[
                { label: 'Previous', value: response()!.previousName },
                { label: 'Name', value: response()!.name },
              ]}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Renamed' : 'Rename'}{' '}
            <ChannelPreview channelId={ctx.tool.data.channelId} /> to{' '}
            <span class="text-ink">{ctx.tool.data.name}</span>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={ctx.response ? 'Renamed' : undefined}
          />
        </div>
      </BaseTool>
    );
  },
});

const manageChannelParticipantsHandler = createToolRenderer({
  name: 'ManageChannelParticipants',
  handleResponse: (ctx) => {
    void invalidateChannelParticipants(ctx.tool.data.channelId);
  },
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    const adding = () => ctx.tool.data.action === 'add';
    const participants = () =>
      response()?.participants ?? ctx.tool.data.participants;
    useWhenPresent(response, (data) => {
      void invalidateChannelParticipants(data.channelId);
    });

    return (
      <BaseTool
        icon={Users}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              summary={response()!.summary}
              details={[
                {
                  label: adding() ? 'Added' : 'Removed',
                  value: participants().map(displayParticipant).join(', '),
                },
              ]}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {adding() ? 'Add members to' : 'Remove members from'}{' '}
            <ChannelPreview channelId={ctx.tool.data.channelId} />
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={ctx.response ? (adding() ? 'Added' : 'Removed') : undefined}
          />
        </div>
      </BaseTool>
    );
  },
});

export {
  createChannelHandler,
  manageChannelParticipantsHandler,
  renameChannelHandler,
};
