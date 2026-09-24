import { EntityDetail } from '@app/components/entity-detail/EntityDetail';
import type { EntityDetailTarget } from '@app/components/entity-detail/EntityDetailNavigationStack';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import {
  ChannelDetailActions,
  ChannelDetailTabs,
} from '@channel/Channel/ChannelDetail';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewBlockTarget } from '@components/app/previewTarget';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { type Accessor, createMemo, Match, Show, Switch } from 'solid-js';
import { isInboxDocumentType } from '../inbox-route-schema';
import { useInboxView } from '../inbox-view-context';
import { HomeReturnBreadcrumb } from './HomeReturnBreadcrumb';

type DetailParams = {
  channelId?: string;
  documentType?: string;
  documentId?: string;
};

/** The shared details that can render without a legacy block instance. */
function entityDetailTarget(
  params: DetailParams,
  preview: PreviewBlockTarget | undefined
): EntityDetailTarget | undefined {
  if (!preview) return;
  if (params.channelId && preview.blockType === 'channel') {
    const location = preview.params as Record<string, unknown> | undefined;
    const messageId = location?.[CHANNEL_URL_PARAMS.message];
    const threadId = location?.[CHANNEL_URL_PARAMS.thread];
    return {
      type: 'channel',
      id: params.channelId,
      ...(typeof messageId === 'string'
        ? {
            target: {
              messageId,
              ...(typeof threadId === 'string' ? { threadId } : {}),
            },
          }
        : {}),
    };
  }

  const { documentType, documentId } = params;
  if (
    !documentType ||
    !documentId ||
    !isInboxDocumentType(documentType) ||
    documentType === 'spreadsheet' ||
    documentType === 'unknown' ||
    preview.params
  ) {
    // The shared file details do not yet navigate to document comments.
    return;
  }
  const subType =
    documentType === 'task' ||
    documentType === 'snippet' ||
    documentType === 'skill'
      ? { type: documentType }
      : undefined;
  return {
    type: 'document',
    id: documentId,
    fileType: subType ? 'md' : documentType === 'csv' ? 'code' : documentType,
    ...(subType ? { subType } : {}),
  };
}

function InboxEntityDetailBody(props: {
  target: EntityDetailTarget;
  value: Accessor<string>;
  navigationRequest: number;
}) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Show when={props.target.type !== 'channel'}>
        <ViewShell.TopBar>
          <ViewBreadcrumbs.Outlet aria-label="Home location" />
          <div class="ml-auto">
            <SidePanel.Toggle />
          </div>
        </ViewShell.TopBar>
      </Show>
      <div class="relative min-h-0 min-w-0 flex-1">
        <EntityDetail
          target={props.target}
          navigationRequest={props.navigationRequest}
        >
          {(context) => {
            const name = () => {
              switch (context.type) {
                case 'channel':
                  return context.name();
                case 'document':
                  return context.documentMetadata.documentName;
              }
            };
            const channel = () =>
              context.type === 'channel' ? context : undefined;

            return (
              <>
                <ViewBreadcrumbs.Item
                  value={props.value()}
                  metadata={props.target}
                  order={1}
                >
                  {(item) => (
                    <ViewBreadcrumbs.Button
                      isActive={item.isActive()}
                      onClick={item.onSelect}
                      tooltip={name()}
                    >
                      <span class="truncate">{name()}</span>
                    </ViewBreadcrumbs.Button>
                  )}
                </ViewBreadcrumbs.Item>
                <Show when={channel()}>
                  {(current) => (
                    <ViewShell.TopBar class="gap-3">
                      <ViewBreadcrumbs.Outlet aria-label="Channel location" />
                      <ChannelDetailTabs channelId={current().channelId} />
                      <ChannelDetailActions channelId={current().channelId} />
                    </ViewShell.TopBar>
                  )}
                </Show>
              </>
            );
          }}
        </EntityDetail>
      </div>
    </div>
  );
}

function InboxDirectDetail(props: {
  target: EntityDetailTarget;
  closePreview: () => void;
  navigationRequest: number;
}) {
  const value = () => `${props.target.type}:${props.target.id}`;

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'home') props.closePreview();
      }}
    >
      <ViewBreadcrumbs.Item value="home" metadata={null} order={0}>
        {(item) => (
          <ViewBreadcrumbs.ReturnButton onClick={item.onSelect}>
            Home
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <SidePanel.Root>
        <InboxEntityDetailBody
          target={props.target}
          value={value}
          navigationRequest={props.navigationRequest}
        />
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

/** Home's typed channel and document routes; unsupported locations keep the block preview. */
export function InboxEntityDetailRouteView() {
  const params = useParams<DetailParams>();
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { previewTarget, previewNavigationRequest, closePreview } =
    useInboxView();
  const detail = createMemo(() => entityDetailTarget(params, previewTarget()));

  return (
    <Switch>
      <Match when={detail()}>
        {(target) => (
          <InboxDirectDetail
            target={target()}
            closePreview={closePreview}
            navigationRequest={previewNavigationRequest()}
          />
        )}
      </Match>
      <Match when={true}>
        <PreviewPanel
          target={previewTarget()}
          navigationRequest={previewNavigationRequest()}
          orchestrator={orchestrator}
          splitPanelContext={panel}
          headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
        />
      </Match>
    </Switch>
  );
}
