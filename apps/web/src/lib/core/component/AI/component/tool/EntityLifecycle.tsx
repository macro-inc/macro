import { ItemPreview } from '@core/component/ItemPreview';
import Copy from '@icon/system/regular/copy.svg';
import PencilSimple from '@icon/system/regular/pencil-simple.svg';
import ShareNetwork from '@icon/system/regular/share-network.svg';
import Trash from '@icon/system/regular/trash.svg';
import type {
  DuplicableEntityType,
  RenameableEntityType,
  ShareAccess,
  SharingEntityType,
  TrashableEntityType,
} from '@service-cognition/generated/tools/types';
import type { ItemType } from '@service-storage/client';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type LifecycleEntityType =
  | TrashableEntityType
  | DuplicableEntityType
  | RenameableEntityType
  | SharingEntityType;

const ITEM_TYPES: Record<LifecycleEntityType, ItemType> = {
  document: 'document',
  chat: 'chat',
  project: 'project',
};

function EntityPreview(props: { id: string; type: LifecycleEntityType }) {
  return (
    <Suspense>
      <ItemPreview
        class="inline-flex align-middle ring-0"
        id={props.id}
        type={ITEM_TYPES[props.type]}
      />
    </Suspense>
  );
}

export const moveToTrashHandler = createToolRenderer({
  name: 'MoveToTrash',
  render: (ctx) => (
    <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        {ctx.response ? 'Moved' : 'Move'}{' '}
        <EntityPreview
          id={ctx.tool.data.entityId}
          type={ctx.tool.data.entityType}
        />{' '}
        to the trash
      </div>
    </BaseTool>
  ),
});

export const duplicateItemHandler = createToolRenderer({
  name: 'DuplicateItem',
  render: (ctx) => (
    <BaseTool icon={Copy} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        <Show
          when={ctx.response?.data}
          fallback={
            <>
              Duplicate{' '}
              <EntityPreview
                id={ctx.tool.data.entityId}
                type={ctx.tool.data.entityType}
              />
            </>
          }
        >
          {(response) => (
            <>
              Duplicated{' '}
              <EntityPreview
                id={response().sourceId}
                type={response().entityType}
              />{' '}
              as{' '}
              <EntityPreview
                id={response().copyId}
                type={response().entityType}
              />
            </>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const renameItemHandler = createToolRenderer({
  name: 'RenameItem',
  render: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        {ctx.response ? 'Renamed' : 'Rename'}{' '}
        <EntityPreview
          id={ctx.tool.data.entityId}
          type={ctx.tool.data.entityType}
        />{' '}
        to <span class="text-ink">{ctx.tool.data.name}</span>
      </div>
    </BaseTool>
  ),
});

const ACCESS_LABELS: Record<ShareAccess, string> = {
  off: 'Off',
  view: 'Can view',
  comment: 'Can comment',
  edit: 'Can edit',
};

const LINK_LABELS = {
  off: 'Off',
  public: 'Anyone with the link',
  team: 'Team members with the link',
} as const;

export const updateSharingHandler = createToolRenderer({
  name: 'UpdateSharing',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const details = () => {
      const data = ctx.tool.data;
      return [
        data.linkScope != null && {
          label: 'Link',
          value: LINK_LABELS[data.linkScope],
        },
        data.linkAccess != null && {
          label: 'Link access',
          value: ACCESS_LABELS[data.linkAccess],
        },
        data.teamAccess != null && {
          label: 'Team',
          value: ACCESS_LABELS[data.teamAccess],
        },
      ].filter((detail) => !!detail);
    };
    const channels = () => ctx.tool.data.channels ?? [];

    return (
      <BaseTool
        icon={ShareNetwork}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <dl class="flex flex-col gap-2 rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs">
              <For each={details()}>
                {(detail) => (
                  <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                    <dt class="text-ink-extra-muted">{detail.label}</dt>
                    <dd class="min-w-0 text-ink">{detail.value}</dd>
                  </div>
                )}
              </For>
              <For each={channels()}>
                {(channel) => (
                  <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                    <dt class="min-w-0 text-ink-extra-muted">
                      <Suspense>
                        <ItemPreview
                          class="inline-flex align-middle ring-0"
                          id={channel.channelId}
                          type="channel"
                        />
                      </Suspense>
                    </dt>
                    <dd class="min-w-0 text-ink">
                      {ACCESS_LABELS[channel.access]}
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {ctx.response ? 'Updated sharing on' : 'Update sharing on'}{' '}
            <EntityPreview
              id={ctx.tool.data.entityId}
              type={ctx.tool.data.entityType}
            />
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={details().length > 0 || channels().length > 0}
          />
        </div>
      </BaseTool>
    );
  },
});
